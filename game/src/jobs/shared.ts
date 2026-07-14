import { desc, eq } from "drizzle-orm";
import type { Env } from "../config.js";
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
  const placeRps = limits?.place_tile?.max_per_sec ?? 20;
  return new TokenBucketRateLimiter(placeRps, placeRps);
}

export function defaultPlaceDelayMs(): number {
  return pollIntervalMsForRps(20);
}

export interface PlaceTileResult {
  ok: boolean;
  rejected?: { reason: string; retry_after?: number };
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
  const result = placeRes.json() as {
    accepted?: unknown;
    rejected?: { reason: string; retry_after?: number };
  };
  if (result.rejected) {
    return { ok: false, rejected: result.rejected };
  }
  return { ok: true };
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
