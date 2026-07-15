import type { Env } from "../config.js";
import { GameClient } from "../client/gameClient.js";
import type { Database } from "../db/index.js";
import type { TokenBucketRateLimiter } from "../pollers/rateLimiter.js";
import {
  runAutoClaimWorkers,
  runUiQueueWorkers,
  type WorkerContext,
} from "./claimWorkerPool.js";
import { pickClaimTarget, type Point } from "./claimStrategy.js";
import {
  buildOwnershipMap,
  createAutoClaimUiYieldProbe,
  createJobState,
  defaultPlaceDelayMs,
  loadMap,
  logJobEvent,
  ownerName,
  resolveSelfContext,
  scheduleJobTick,
  stopJobState,
  takeUiClaimQueue,
  UI_CLAIM_DRAIN_BATCH,
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

function buildWorkerContext(
  env: Env,
  db: Database,
  client: GameClient,
  limiter: TokenBucketRateLimiter,
  map: NonNullable<Awaited<ReturnType<typeof loadMap>>>,
  self: SelfContext,
): WorkerContext {
  return {
    env,
    db,
    client,
    limiter,
    map,
    self,
    recordSuccess: recordRecentClaim,
    ownedSet: buildOwnershipMap(map.tiles, self.name).owned,
    pendingClaims: new Set<string>(),
  };
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
        preview ? { x: preview.x, y: preview.y } : undefined,
      );
      schedule(defaultPlaceDelayMs());
      return;
    }

    const workerCtx = buildWorkerContext(env, db, client, limiter, map, self);
    const uiBatch = await takeUiClaimQueue(env, UI_CLAIM_DRAIN_BATCH);

    if (uiBatch.length > 0) {
      const { placed } = await runUiQueueWorkers(workerCtx, uiBatch);
      if (placed > 0) {
        schedule(0);
        return;
      }
      // Unreachable UI tiles were dropped — fall through to auto so we do not
      // spin take/requeue forever while the queue blocks claiming.
      await logJobEvent(
        db,
        "warn",
        "claim_ui_unreachable",
        `dropped ${uiBatch.length} UI-queue tiles with no adjacent/bridge progress`,
      );
    }

    // Yield as soon as UI activity or queue pending is seen (cached ~50ms).
    const { placed } = await runAutoClaimWorkers(
      workerCtx,
      recentClaims,
      createAutoClaimUiYieldProbe(env),
    );

    if (placed === 0) {
      await logJobEvent(db, "info", "claim_idle", "no claim target or rate budget empty");
      schedule(defaultPlaceDelayMs());
      return;
    }

    schedule(0);
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

export { pickClaimTarget as pickTileTarget } from "./claimStrategy.js";
