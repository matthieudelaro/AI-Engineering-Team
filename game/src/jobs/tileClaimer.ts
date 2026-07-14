import type { Env } from "../config.js";
import { GameClient } from "../client/gameClient.js";
import type { Database } from "../db/index.js";
import type { TokenBucketRateLimiter } from "../pollers/rateLimiter.js";
import { pickClaimTarget, type Point } from "./claimStrategy.js";
import {
  createJobState,
  defaultPlaceDelayMs,
  loadMap,
  logJobEvent,
  ownerName,
  placeTile,
  resolveSelfContext,
  scheduleJobTick,
  stopJobState,
  type JobHandle,
  type SelfContext,
} from "./shared.js";

const MAX_RECENT_CLAIMS = 24;

const recentClaims: Point[] = [];

function recordRecentClaim(x: number, y: number): void {
  const k = `${x},${y}`;
  const existing = recentClaims.findIndex((p) => `${p.x},${p.y}` === k);
  if (existing !== -1) {
    recentClaims.splice(existing, 1);
  }
  recentClaims.unshift({ x, y });
  if (recentClaims.length > MAX_RECENT_CLAIMS) {
    recentClaims.length = MAX_RECENT_CLAIMS;
  }
}

function pruneRecentClaims(
  map: Awaited<ReturnType<typeof loadMap>>,
  self: SelfContext,
): void {
  if (!map) {
    return;
  }
  for (let i = recentClaims.length - 1; i >= 0; i--) {
    const p = recentClaims[i]!;
    const tile = map.tiles.find((t) => t.x === p.x && t.y === p.y);
    if (ownerName(tile?.ownership ?? "") !== self.name) {
      recentClaims.splice(i, 1);
    }
  }
}

async function claimerTick(
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
    scheduleJobTick(state, () => claimerTick(env, db, state, limiter, selfCache), delayMs);

  try {
    const self = await resolveSelfContext(db, selfCache);
    const map = await loadMap(db);

    if (!map?.tiles) {
      await logJobEvent(db, "warn", "claim_no_map", "no map data available");
      schedule(env.POLL_INTERVAL_MS);
      return;
    }

    pruneRecentClaims(map, self);

    if (env.DRY_RUN) {
      const preview = pickClaimTarget(map, self, recentClaims);
      await logJobEvent(
        db,
        "info",
        "claim_dry_run",
        preview ? `would claim ${preview.x},${preview.y}` : "no target",
        preview ?? undefined,
      );
      schedule(defaultPlaceDelayMs());
      return;
    }

    const inFlight: Array<Promise<void>> = [];
    while (limiter.tryAcquire()) {
      const target = pickClaimTarget(map, self, recentClaims);
      if (!target) {
        break;
      }

      inFlight.push(
        (async () => {
          const result = await placeTile(client, null, env.GAME_ID, target.x, target.y);
          if (!result.ok) {
            await logJobEvent(db, "warn", "claim_rejected", result.rejected!.reason, {
              x: target.x,
              y: target.y,
            });
            return;
          }
          recordRecentClaim(target.x, target.y);
        })(),
      );
    }

    if (inFlight.length === 0) {
      await logJobEvent(db, "info", "claim_idle", "no claim target or rate budget empty");
      schedule(defaultPlaceDelayMs());
      return;
    }

    void Promise.all(inFlight).finally(() => {
      schedule(defaultPlaceDelayMs());
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "claim error";
    await logJobEvent(db, "error", "claim_error", message);
    schedule(env.POLL_INTERVAL_MS * 2);
  }
}

export async function startTileClaimer(
  env: Env,
  db: Database,
  limiter: TokenBucketRateLimiter,
): Promise<JobHandle> {
  const state = createJobState();
  const selfCache = { value: null as SelfContext | null };

  await logJobEvent(db, "info", "claim_start", "tile claimer started (gateway audited, source=job)");

  void claimerTick(env, db, state, limiter, selfCache);

  return {
    stop: () => stopJobState(state),
  };
}

// Re-export for tests that imported pickTileTarget from here.
export { pickClaimTarget as pickTileTarget } from "./claimStrategy.js";
