import { desc, eq } from "drizzle-orm";
import { getGatewayBaseUrl, type Env } from "../config.js";
import { GameClient } from "../client/gameClient.js";
import type { Database } from "../db/index.js";
import { gameStates, policyEvents } from "../db/schema.js";
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

/** Cells we already own or have reserved for an in-flight place-tile. */
export function blockedClaimCells(
  owned: Set<string>,
  pending?: Set<string>,
): Set<string> {
  if (!pending || pending.size === 0) {
    return owned;
  }
  const blocked = new Set(owned);
  for (const key of pending) {
    blocked.add(key);
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
    if (owned.has(`${tile.x},${tile.y}`)) {
      alreadyOwned.push(tile);
    } else {
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
  const owned = ownedSet ?? buildOwnershipMap(map.tiles, selfName).owned;
  const blocked = blockedClaimCells(owned, pendingSet);
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
  const rows = await db
    .select()
    .from(gameStates)
    .where(eq(gameStates.endpointKey, endpointKey))
    .orderBy(desc(gameStates.fetchedAt))
    .limit(1);
  return (rows[0]?.payloadJson as T | undefined) ?? null;
}

export interface SelfContext {
  name: string | null;
  tileCount: number;
}

export async function resolveSelfContext(
  db: Database,
  cache: { value: SelfContext | null },
): Promise<SelfContext> {
  if (cache.value) {
    return cache.value;
  }

  const lbState = await readLatestState<LeaderboardResponse>(db, "leaderboard");
  if (lbState?.entries) {
    const self = lbState.entries.find((e) => e.is_self);
    if (self) {
      cache.value = {
        name: self.display_name,
        tileCount: self.tile_count ?? 0,
      };
      return cache.value;
    }
  }

  return { name: null, tileCount: 0 };
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
  // Pace just under the API cap so steady-state rarely trips RATE_LIMITED.
  // Small burst avoids a stampede after pause; refill sustains pacedRps.
  const pacedRps = Math.max(1, placeRps - 1);
  const burst = Math.min(4, pacedRps);
  return new TokenBucketRateLimiter(pacedRps, burst);
}

/**
 * Parallel place-tile workers. Sized for ~1s RTT at ~20/s (20 × 1s ≈ 20 in flight).
 */
export const PLACE_TILE_WORKER_COUNT = 25;

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
  if (typeof resetUnixSec === "number" && Number.isFinite(resetUnixSec) && resetUnixSec > 0) {
    return Math.max(50, resetUnixSec * 1000 - nowMs + 25);
  }
  if (typeof retryAfterSec === "number" && retryAfterSec > 0) {
    return retryAfterSec * 1000;
  }
  return 1000;
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
