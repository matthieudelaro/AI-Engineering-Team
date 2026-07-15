import { desc, eq } from "drizzle-orm";
import { getGatewayBaseUrl, type Env } from "../config.js";
import { GameClient } from "../client/gameClient.js";
import type { Database } from "../db/index.js";
import { gameStates, policyEvents } from "../db/schema.js";
import { pickUsableCachedRow } from "../state/usablePayload.js";
import {
  fetchMethodLimits,
  pollIntervalMsForRps,
} from "../pollers/methodLimits.js";
import { TokenBucketRateLimiter } from "../pollers/rateLimiter.js";

export interface JobHandle {
  stop: () => void;
}

export interface MapTile {
  x: number;
  y: number;
  ownership: string | Record<string, unknown>;
  has_flag?: boolean;
}

export interface MapResponse {
  bounds: { min_x: number; min_y: number; max_x: number; max_y: number };
  tiles: MapTile[];
}

export interface LeaderboardResponse {
  entries: Array<{
    display_name: string;
    is_self: boolean;
    tile_count?: number;
  }>;
}

export const NEIGHBORS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];

export function ownerName(
  ownership: string | Record<string, unknown>,
): string | null {
  if (typeof ownership === "string") {
    return ownership === "" || ownership === "neutral" ? null : ownership;
  }
  if (typeof ownership === "object" && ownership !== null) {
    const owned = ownership["owned"];
    return typeof owned === "string" && owned !== "" ? owned : null;
  }
  return null;
}

export function buildOwnershipMap(
  tiles: MapTile[],
  selfName: string | null,
): { owned: Set<string>; occupied: Map<string, string | null> } {
  const owned = new Set<string>();
  const occupied = new Map<string, string | null>();
  for (const tile of tiles) {
    const key = `${tile.x},${tile.y}`;
    const owner = ownerName(tile.ownership);
    occupied.set(key, owner);
    if (owner === selfName) {
      owned.add(key);
    }
  }
  return { owned, occupied };
}

/**
 * Cells we must not place-tile on: already owned by us, or reserved in-flight.
 * Adjacent enemy tiles are allowed — that's how you break out when surrounded.
 */
export function blockedClaimCells(
  owned: Set<string>,
  pending?: Set<string>,
  _occupied?: Map<string, string | null>,
  _selfName?: string | null,
): Set<string> {
  const blocked = new Set(owned);
  if (pending) {
    for (const key of pending) {
      blocked.add(key);
    }
  }
  return blocked;
}

/** Split tiles into ones we still need to claim vs ones we already own (local map). */
export function partitionBySelfOwnership<T extends { x: number; y: number }>(
  tiles: T[],
  map: MapResponse,
  selfName: string | null,
): { claimable: T[]; alreadyOwned: T[] } {
  const { owned } = buildOwnershipMap(map.tiles, selfName);
  const claimable: T[] = [];
  const alreadyOwned: T[] = [];
  for (const tile of tiles) {
    const key = `${tile.x},${tile.y}`;
    if (owned.has(key)) {
      alreadyOwned.push(tile);
    } else {
      // Empty and enemy tiles stay claimable (attacks are valid place-tiles).
      claimable.push(tile);
    }
  }
  return { claimable, alreadyOwned };
}

/** Update the local map snapshot after a successful claim (avoids stale INVALID_TARGET). */
export function markTileOwned(
  map: MapResponse,
  selfName: string,
  x: number,
  y: number,
): void {
  const existing = map.tiles.find((t) => t.x === x && t.y === y);
  if (existing) {
    existing.ownership = { owned: selfName };
    return;
  }
  map.tiles.push({ x, y, ownership: { owned: selfName } });
}

export function isOrthogonallyAdjacentToSelf(
  map: MapResponse,
  selfName: string | null,
  x: number,
  y: number,
  ownedSet?: Set<string>,
): boolean {
  if (!selfName) {
    return false;
  }
  const owned = ownedSet ?? buildOwnershipMap(map.tiles, selfName).owned;
  for (const { dx, dy } of NEIGHBORS) {
    if (owned.has(`${x + dx},${y + dy}`)) {
      return true;
    }
  }
  return false;
}

/**
 * Index of the next UI-queue tile to attempt: prefer orthogonally adjacent
 * (still FIFO among those), else null when nothing is currently claimable.
 */
export function findNextAdjacentUiClaimIndex<T extends { x: number; y: number }>(
  work: T[],
  fromIndex: number,
  map: MapResponse,
  selfName: string | null,
  ownedSet?: Set<string>,
): number | null {
  for (let i = fromIndex; i < work.length; i++) {
    const tile = work[i]!;
    if (isOrthogonallyAdjacentToSelf(map, selfName, tile.x, tile.y, ownedSet)) {
      return i;
    }
  }
  return null;
}

/** One orthogonal step from our frontier toward the nearest queued target. */
export function pickBridgeStepToward(
  map: MapResponse,
  selfName: string | null,
  targets: Array<{ x: number; y: number }>,
  ownedSet?: Set<string>,
  pendingSet?: Set<string>,
): { x: number; y: number } | null {
  if (!selfName || targets.length === 0) {
    return null;
  }
  const { owned: ownedFromMap, occupied } = buildOwnershipMap(map.tiles, selfName);
  const owned = ownedSet ?? ownedFromMap;
  const blocked = blockedClaimCells(owned, pendingSet, occupied, selfName);
  const targetKeys = new Set(targets.map((t) => `${t.x},${t.y}`));
  let best: { x: number; y: number; score: number } | null = null;

  for (const k of owned) {
    const [xs, ys] = k.split(",");
    const ox = Number(xs);
    const oy = Number(ys);
    for (const { dx, dy } of NEIGHBORS) {
      const x = ox + dx;
      const y = oy + dy;
      if (
        x < map.bounds.min_x ||
        x > map.bounds.max_x ||
        y < map.bounds.min_y ||
        y > map.bounds.max_y
      ) {
        continue;
      }
      const cell = `${x},${y}`;
      if (blocked.has(cell)) {
        continue;
      }
      if (targetKeys.has(cell)) {
        return { x, y };
      }
      let score = Number.POSITIVE_INFINITY;
      for (const t of targets) {
        const d = Math.abs(t.x - x) + Math.abs(t.y - y);
        if (d < score) {
          score = d;
        }
      }
      if (!best || score < best.score) {
        best = { x, y, score };
      }
    }
  }

  return best ? { x: best.x, y: best.y } : null;
}

/** Orthogonally adjacent frontier tiles we can claim next. */
export function frontierCandidates(
  owned: Set<string>,
  occupied: Map<string, string | null>,
  selfName: string | null,
  bounds: MapResponse["bounds"],
): Array<{ x: number; y: number }> {
  const candidates: Array<{ x: number; y: number }> = [];
  const seen = new Set<string>();

  for (const key of owned) {
    const [xs, ys] = key.split(",");
    const x0 = Number(xs);
    const y0 = Number(ys);
    for (const { dx, dy } of NEIGHBORS) {
      const x = x0 + dx;
      const y = y0 + dy;
      if (
        x < bounds.min_x ||
        x > bounds.max_x ||
        y < bounds.min_y ||
        y > bounds.max_y
      ) {
        continue;
      }
      const cellKey = `${x},${y}`;
      if (seen.has(cellKey) || owned.has(cellKey)) {
        continue;
      }
      const owner = occupied.get(cellKey);
      if (owner === selfName) {
        continue;
      }
      seen.add(cellKey);
      candidates.push({ x, y });
    }
  }

  return candidates;
}

export async function logJobEvent(
  db: Database,
  level: "info" | "warn" | "error",
  eventType: string,
  message: string,
  data?: Record<string, unknown>,
): Promise<void> {
  await db.insert(policyEvents).values({
    runId: null,
    level,
    eventType,
    message,
    dataJson: data ?? null,
    source: "job",
  });
}

export async function readLatestState<T>(
  db: Database,
  endpointKey: string,
): Promise<T | null> {
  // Fetch one row at a time so a usable empty/new-game snapshot is not drowned
  // by multi‑MB payloads from prior games in the same table.
  const batchSize = 1;
  const maxAttempts = 20;
  for (let offset = 0; offset < maxAttempts; offset += batchSize) {
    const rows = await db
      .select()
      .from(gameStates)
      .where(eq(gameStates.endpointKey, endpointKey))
      .orderBy(desc(gameStates.fetchedAt))
      .limit(batchSize)
      .offset(offset);
    if (rows.length === 0) {
      return null;
    }
    const row = pickUsableCachedRow(endpointKey, rows);
    if (row) {
      return (row.payloadJson as T | undefined) ?? null;
    }
  }
  return null;
}

export interface SelfContext {
  name: string | null;
  tileCount: number;
}

export async function resolveSelfContext(
  db: Database,
  cache: { value: SelfContext | null },
): Promise<SelfContext> {
  const lbState = await readLatestState<LeaderboardResponse>(db, "leaderboard");
  if (lbState?.entries) {
    const self = lbState.entries.find((e) => e.is_self);
    if (self) {
      const next: SelfContext = {
        name: self.display_name,
        tileCount: self.tile_count ?? 0,
      };
      // Always refresh — a new game changes display name / tile count.
      cache.value = next;
      return next;
    }
  }

  return cache.value ?? { name: null, tileCount: 0 };
}

/** Map snapshot from pollers — never calls the game API directly. */
export async function loadMap(db: Database): Promise<MapResponse | null> {
  const cached = await readLatestState<MapResponse>(db, "map");
  if (!cached?.tiles) {
    return null;
  }
  return cached;
}

export async function createPlaceTileLimiter(
  env: Env,
): Promise<TokenBucketRateLimiter> {
  const client = new GameClient(env, { source: "job" });
  const limits = await fetchMethodLimits(client, env.GAME_ID);
  const placeRps = Math.max(1, limits?.place_tile?.max_per_sec ?? 20);
  // Stay under the API's per-second fixed window. The limiter also caps starts
  // per wall-clock second and waits for the next second instead of 429'ing.
  const pacedRps = Math.max(1, placeRps - 2);
  return new TokenBucketRateLimiter(pacedRps, 1, 8, 400);
}

/**
 * Parallel place-tile workers. Sized for ~19/s × ~0.9s RTT ≈ 17 in flight.
 */
export const PLACE_TILE_WORKER_COUNT = 18;

/** @deprecated Use PLACE_TILE_WORKER_COUNT */
export const PLACE_TILE_MAX_IN_FLIGHT = PLACE_TILE_WORKER_COUNT;

/** How many UI-queue tiles to lease when the local buffer runs low. */
export const UI_CLAIM_DRAIN_BATCH = 60;

export function defaultPlaceDelayMs(): number {
  return pollIntervalMsForRps(20);
}

export interface PlaceTileResult {
  ok: boolean;
  rateLimited?: boolean;
  /** Unix timestamp (seconds) from X-RateLimit-Reset when present. */
  rateLimitReset?: number;
  rateLimitRemaining?: number;
  rejected?: { reason: string; retry_after?: number };
}

/** True when the game API rejected place-tile for rate limiting. */
export function isPlaceTileRateLimited(
  reason: string | undefined,
  status?: number,
): boolean {
  if (status === 429) {
    return true;
  }
  if (!reason) {
    return false;
  }
  return reason.includes("RATE_LIMITED");
}

/** Milliseconds to wait until the rate-limit window resets. */
export function msUntilRateLimitReset(
  resetUnixSec: number | undefined,
  retryAfterSec?: number,
  nowMs: number = Date.now(),
): number {
  const msToNextWallSec = 1000 - (nowMs % 1000) + 50;
  const capMs = 2_000;
  if (typeof resetUnixSec === "number" && Number.isFinite(resetUnixSec) && resetUnixSec > 0) {
    // Accept unix seconds or unix milliseconds.
    const resetMs = resetUnixSec > 1e12 ? resetUnixSec : resetUnixSec * 1000;
    const untilReset = resetMs - nowMs + 50;
    // API often sets X-RateLimit-Reset to the *current* unix second while the
    // window is still closed. A past/near-zero wait must advance to the next
    // wall-clock second or we immediate-retry into another 429.
    return Math.min(capMs, Math.max(msToNextWallSec, untilReset));
  }
  // API often returns retry_after: 0 meaning "window edge / retry ASAP".
  if (typeof retryAfterSec === "number" && Number.isFinite(retryAfterSec)) {
    if (retryAfterSec <= 0) {
      return msToNextWallSec;
    }
    return Math.min(capMs, Math.max(50, retryAfterSec * 1000));
  }
  return msToNextWallSec;
}

function parseRateLimitHeaders(headers: Headers): {
  reset?: number;
  remaining?: number;
} {
  const resetRaw = headers.get("x-ratelimit-reset");
  const remainingRaw = headers.get("x-ratelimit-remaining");
  const reset = resetRaw !== null ? Number.parseInt(resetRaw, 10) : Number.NaN;
  const remaining =
    remainingRaw !== null ? Number.parseInt(remainingRaw, 10) : Number.NaN;
  return {
    reset: Number.isFinite(reset) ? reset : undefined,
    remaining: Number.isFinite(remaining) ? remaining : undefined,
  };
}

export async function placeTile(
  client: GameClient,
  limiter: TokenBucketRateLimiter | null,
  gameId: string,
  x: number,
  y: number,
): Promise<PlaceTileResult> {
  if (limiter) {
    await limiter.acquire();
  }
  const placeRes = await client.post("/api/v1/place-tile", {
    x,
    y,
    game_id: gameId,
  });
  const rateHeaders = parseRateLimitHeaders(placeRes.headers);
  const result = placeRes.json() as {
    accepted?: unknown;
    rejected?: { reason: string; retry_after?: number };
  };
  if (result.rejected || placeRes.status === 429) {
    const rejected = result.rejected ?? {
      reason: "REJECTION_REASON_RATE_LIMITED",
      retry_after: 1,
    };
    return {
      ok: false,
      rateLimited: isPlaceTileRateLimited(rejected.reason, placeRes.status),
      rateLimitReset: rateHeaders.reset,
      rateLimitRemaining: rateHeaders.remaining,
      rejected,
    };
  }
  return {
    ok: true,
    rateLimitReset: rateHeaders.reset,
    rateLimitRemaining: rateHeaders.remaining,
  };
}

/**
 * Whether the UI currently holds claim priority. Jobs back off while active so
 * user-driven claims win. Fails open (false) on timeout or error so job claiming
 * is never blocked by an unreachable gateway.
 */
export async function isUiClaimActive(env: Env): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 500);
  try {
    const res = await fetch(`${getGatewayBaseUrl(env)}/_gateway/ui-claim-active`, {
      signal: controller.signal,
    });
    if (!res.ok) {
      return false;
    }
    const body = (await res.json()) as { active?: unknown };
    return body.active === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Non-destructive peek: true when the UI claim queue has pending tiles.
 * Fails open (false) on timeout or error so auto-claim is never blocked.
 */
export async function hasUiClaimQueueWork(env: Env): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 500);
  try {
    const res = await fetch(`${getGatewayBaseUrl(env)}/_gateway/ui-claim-queue`, {
      signal: controller.signal,
    });
    if (!res.ok) {
      return false;
    }
    const body = (await res.json()) as { pending?: unknown };
    return typeof body.pending === "number" && body.pending > 0;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Auto-claim should yield when the UI is painting or the queue has work.
 * Fails open (false) if both probes fail open.
 */
export async function shouldYieldAutoClaimToUi(env: Env): Promise<boolean> {
  if (await isUiClaimActive(env)) {
    return true;
  }
  return hasUiClaimQueueWork(env);
}

/** Cache window so 18 workers do not hammer the gateway on every acquire. */
export const AUTO_CLAIM_UI_YIELD_CACHE_MS = 50;

/**
 * shouldStop callback for auto-claim: yields on UI activity or queue pending,
 * with a short positive/negative cache to limit gateway traffic.
 */
export function createAutoClaimUiYieldProbe(
  env: Env,
  cacheMs: number = AUTO_CLAIM_UI_YIELD_CACHE_MS,
  now: () => number = Date.now,
): () => Promise<boolean> {
  let cachedAt = Number.NEGATIVE_INFINITY;
  let cachedValue = false;

  return async () => {
    const t = now();
    if (t - cachedAt < cacheMs) {
      return cachedValue;
    }
    cachedValue = await shouldYieldAutoClaimToUi(env);
    cachedAt = t;
    return cachedValue;
  };
}

export interface UiClaimQueueTile {
  x: number;
  y: number;
  isRetry: boolean;
}

const UI_CLAIM_QUEUE_TAKE_LIMIT = 20;

/**
 * Dequeue UI claim targets from the gateway. Fails open to an empty list when
 * the gateway is unreachable.
 */
export async function takeUiClaimQueue(
  env: Env,
  limit: number = UI_CLAIM_QUEUE_TAKE_LIMIT,
): Promise<UiClaimQueueTile[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 500);
  try {
    const res = await fetch(`${getGatewayBaseUrl(env)}/_gateway/ui-claim-queue/take`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ limit }),
      signal: controller.signal,
    });
    if (!res.ok) {
      return [];
    }
    const body = (await res.json()) as { tiles?: unknown };
    if (!Array.isArray(body.tiles)) {
      return [];
    }
    const tiles: UiClaimQueueTile[] = [];
    for (const item of body.tiles) {
      if (
        typeof item === "object" &&
        item !== null &&
        typeof (item as { x?: unknown }).x === "number" &&
        typeof (item as { y?: unknown }).y === "number" &&
        typeof (item as { isRetry?: unknown }).isRetry === "boolean"
      ) {
        tiles.push({
          x: (item as UiClaimQueueTile).x,
          y: (item as UiClaimQueueTile).y,
          isRetry: (item as UiClaimQueueTile).isRetry,
        });
      }
    }
    return tiles;
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Schedule one retry for a rejected UI-queue tile. Fails open (no throw) when
 * the gateway is unreachable.
 */
export async function retryUiClaim(env: Env, x: number, y: number): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 500);
  try {
    await fetch(`${getGatewayBaseUrl(env)}/_gateway/ui-claim-queue/retry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ x, y }),
      signal: controller.signal,
    });
  } catch {
    // fail open — job keeps running
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Put UI-queue tiles back at the front (rate limits / unused take).
 * Does not burn the one-shot soft-reject retry.
 */
export async function requeueUiClaims(
  env: Env,
  tiles: Array<{ x: number; y: number }>,
): Promise<void> {
  if (tiles.length === 0) {
    return;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 500);
  try {
    await fetch(`${getGatewayBaseUrl(env)}/_gateway/ui-claim-queue/requeue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tiles }),
      signal: controller.signal,
    });
  } catch {
    // fail open
  } finally {
    clearTimeout(timeout);
  }
}

/** Clear in-flight leases after success or final failure. */
export async function ackUiClaims(
  env: Env,
  tiles: Array<{ x: number; y: number }>,
): Promise<void> {
  if (tiles.length === 0) {
    return;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 500);
  try {
    await fetch(`${getGatewayBaseUrl(env)}/_gateway/ui-claim-queue/ack`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tiles }),
      signal: controller.signal,
    });
  } catch {
    // fail open
  } finally {
    clearTimeout(timeout);
  }
}

interface JobWorkerState {
  stopped: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

export function scheduleJobTick(
  state: JobWorkerState,
  tick: () => Promise<void>,
  delayMs: number,
): void {
  if (state.stopped) {
    return;
  }
  state.timer = setTimeout(() => {
    void tick();
  }, delayMs);
}

export function createJobState(): JobWorkerState {
  return { stopped: false, timer: null };
}

export function stopJobState(state: JobWorkerState): void {
  state.stopped = true;
  if (state.timer) {
    clearTimeout(state.timer);
  }
}
