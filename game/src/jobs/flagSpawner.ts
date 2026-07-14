import type { Env } from "../config.js";
import { GameClient } from "../client/gameClient.js";
import type { Database } from "../db/index.js";
import type { TokenBucketRateLimiter } from "../pollers/rateLimiter.js";
import { NEIGHBORS } from "./shared.js";
import {
  buildOwnershipMap,
  createJobState,
  defaultPlaceDelayMs,
  isUiClaimActive,
  loadMap,
  logJobEvent,
  placeTile,
  readLatestState,
  resolveSelfContext,
  scheduleJobTick,
  stopJobState,
  type JobHandle,
  type MapResponse,
  type SelfContext,
} from "./shared.js";

interface FlagInfo {
  flag_id: string;
  x: number;
  y: number;
  pot: number;
  nuked: boolean;
}

interface FlagsResponse {
  flags: FlagInfo[];
}

/** Flags orthogonally adjacent to our tiles — capturable in one move. */
export function adjacentFlagTargets(
  flags: FlagInfo[],
  owned: Set<string>,
  occupied: Map<string, string | null>,
  selfName: string | null,
): Array<{ x: number; y: number; pot: number }> {
  const targets: Array<{ x: number; y: number; pot: number }> = [];
  const seen = new Set<string>();

  for (const flag of flags) {
    if (flag.nuked) {
      continue;
    }
    const key = `${flag.x},${flag.y}`;
    if (seen.has(key)) {
      continue;
    }
    const owner = occupied.get(key);
    if (owner === selfName) {
      continue;
    }
    if (owner !== null && owner !== undefined) {
      continue;
    }

    let adjacent = false;
    for (const { dx, dy } of NEIGHBORS) {
      if (owned.has(`${flag.x + dx},${flag.y + dy}`)) {
        adjacent = true;
        break;
      }
    }
    if (!adjacent) {
      continue;
    }

    seen.add(key);
    targets.push({ x: flag.x, y: flag.y, pot: flag.pot });
  }

  return targets.sort((a, b) => b.pot - a.pot);
}

/** Step toward a nearby flag through our frontier when not yet adjacent. */
export function stepTowardFlag(
  flags: FlagInfo[],
  owned: Set<string>,
  occupied: Map<string, string | null>,
  selfName: string | null,
  bounds: MapResponse["bounds"],
): { x: number; y: number } | null {
  const activeFlags = flags.filter((f) => !f.nuked);
  if (activeFlags.length === 0 || owned.size === 0) {
    return null;
  }

  let bestFlag: FlagInfo | null = null;
  let bestDist = Infinity;
  for (const flag of activeFlags) {
    const owner = occupied.get(`${flag.x},${flag.y}`);
    if (owner === selfName) {
      continue;
    }
    let minDist = Infinity;
    for (const key of owned) {
      const [xs, ys] = key.split(",");
      const dist =
        Math.abs(flag.x - Number(xs)) + Math.abs(flag.y - Number(ys));
      minDist = Math.min(minDist, dist);
    }
    if (minDist < bestDist || (minDist === bestDist && flag.pot > (bestFlag?.pot ?? 0))) {
      bestDist = minDist;
      bestFlag = flag;
    }
  }

  if (!bestFlag || bestDist <= 1) {
    return null;
  }

  let bestStep: { x: number; y: number } | null = null;
  let bestStepDist = Infinity;

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
      if (owned.has(cellKey)) {
        continue;
      }
      const owner = occupied.get(cellKey);
      if (owner === selfName) {
        continue;
      }
      const dist = Math.abs(bestFlag.x - x) + Math.abs(bestFlag.y - y);
      if (dist < bestStepDist) {
        bestStepDist = dist;
        bestStep = { x, y };
      }
    }
  }

  return bestStep;
}

function pickFlagTarget(
  flags: FlagInfo[],
  map: MapResponse,
  selfName: string | null,
): { x: number; y: number; pot?: number } | null {
  const { owned, occupied } = buildOwnershipMap(map.tiles, selfName);
  const adjacent = adjacentFlagTargets(flags, owned, occupied, selfName);
  if (adjacent.length > 0) {
    return adjacent[0]!;
  }
  return stepTowardFlag(flags, owned, occupied, selfName, map.bounds);
}

async function spawnerTick(
  env: Env,
  db: Database,
  state: ReturnType<typeof createJobState>,
  limiter: TokenBucketRateLimiter,
  selfCache: { value: SelfContext | null },
): Promise<void> {
  if (state.stopped) {
    return;
  }

  const client = new GameClient(env, { source: "job" });
  const schedule = (delayMs: number) =>
    scheduleJobTick(state, () => spawnerTick(env, db, state, limiter, selfCache), delayMs);

  if (await isUiClaimActive(env)) {
    schedule(100);
    return;
  }

  try {
    const self = await resolveSelfContext(db, selfCache);
    const flagsState = await readLatestState<FlagsResponse>(db, "flags");

    if (!flagsState?.flags?.length) {
      await logJobEvent(db, "warn", "spawn_no_flags", "no cached flags snapshot yet");
      schedule(env.POLL_INTERVAL_MS);
      return;
    }

    const map = await loadMap(db);
    if (!map?.tiles) {
      await logJobEvent(db, "warn", "spawn_no_map", "no map data available");
      schedule(env.POLL_INTERVAL_MS);
      return;
    }

    const target = pickFlagTarget(flagsState.flags, map, self.name);
    if (!target) {
      await logJobEvent(db, "info", "spawn_idle", "no flag targets in owned areas");
      schedule(env.POLL_INTERVAL_MS);
      return;
    }

    if (env.DRY_RUN) {
      await logJobEvent(db, "info", "spawn_dry_run", `would claim flag at ${target.x},${target.y}`, {
        pot: target.pot,
      });
      schedule(env.POLL_INTERVAL_MS);
      return;
    }

    const result = await placeTile(client, limiter, env.GAME_ID, target.x, target.y);
    if (!result.ok) {
      await logJobEvent(db, "warn", "spawn_rejected", result.rejected!.reason, {
        x: target.x,
        y: target.y,
      });
      const delayMs = result.rejected?.retry_after
        ? result.rejected.retry_after * 1000
        : defaultPlaceDelayMs();
      schedule(delayMs);
      return;
    }

    await logJobEvent(db, "info", "spawn_ok", `claimed toward flag ${target.x},${target.y}`, {
      pot: target.pot,
    });
    schedule(defaultPlaceDelayMs());
  } catch (error) {
    const message = error instanceof Error ? error.message : "spawn error";
    await logJobEvent(db, "error", "spawn_error", message);
    schedule(env.POLL_INTERVAL_MS * 2);
  }
}

export async function startFlagSpawner(
  env: Env,
  db: Database,
  limiter: TokenBucketRateLimiter,
): Promise<JobHandle> {
  const state = createJobState();
  const selfCache = { value: null as SelfContext | null };

  await logJobEvent(db, "info", "spawn_start", "flag spawner started");

  void spawnerTick(env, db, state, limiter, selfCache);

  return {
    stop: () => stopJobState(state),
  };
}
