import type { Env } from "../../config.js";
import { GameClient } from "../../client/gameClient.js";
import type { Database } from "../../db/index.js";
import type { TokenBucketRateLimiter } from "../../pollers/rateLimiter.js";
import {
  buildOwnershipMap,
  createJobState,
  createPlaceTileLimiter,
  excludeOutOfBoundsCell,
  loadMap,
  logJobEvent,
  markTileOwned,
  msUntilRateLimitReset,
  PLACE_TILE_WORKER_COUNT,
  placeTile,
  readLatestState,
  resolveSelfContext,
  scheduleJobTick,
  stopJobState,
  type JobHandle,
  type MapResponse,
  type SelfContext,
} from "../../jobs/shared.js";
import { pickCartographerClaim } from "./claimPlanner.js";
import { nextBudgetTick } from "./budget.js";
import {
  FlagHunter,
  flagOwnersFromMap,
} from "./flagHunter.js";
import { LassoBandPlanner } from "./lassoBand.js";
import { MapBelief } from "./mapBelief.js";
import type { FlagInfo, FlagsResponse } from "./types.js";

export interface CartographerOptions {
  /** Exit after this many milliseconds (sanity / QA harness). */
  durationMs?: number;
  dryRun?: boolean;
  policyId?: string;
  runId?: number;
}

function isOutOfBounds(reason: string | undefined): boolean {
  return reason?.includes("OUT_OF_BOUNDS") ?? false;
}

function isInvalidTarget(reason: string | undefined): boolean {
  return reason?.includes("INVALID_TARGET") ?? false;
}

async function fetchFlags(client: GameClient, gameId: string): Promise<FlagInfo[]> {
  const res = await client.get(`/api/v1/flags?game_id=${encodeURIComponent(gameId)}`);
  if (res.status !== 200) {
    return [];
  }
  const body = res.json() as FlagsResponse | null;
  return body?.flags ?? [];
}

async function launchNuke(
  client: GameClient,
  gameId: string,
  x: number,
  y: number,
): Promise<boolean> {
  const res = await client.post("/api/v1/launch-nuke", {
    game_id: gameId,
    x,
    y,
  });
  if (res.status === 200 || res.status === 201) {
    const body = res.json() as { accepted?: unknown; rejected?: unknown } | null;
    return body?.accepted !== undefined && !body?.rejected;
  }
  return false;
}

interface AgentState {
  belief: MapBelief | null;
  lasso: LassoBandPlanner;
  flagHunter: FlagHunter;
  map: MapResponse | null;
  tickIndex: number;
  pending: Set<string>;
  startedAt: number;
  flags: FlagInfo[];
  flagOwners: Map<string, string | null>;
}

function syncMap(
  state: AgentState,
  map: MapResponse,
  selfName: string | null,
  nowMs: number,
): void {
  state.map = map;
  if (!state.belief) {
    state.belief = MapBelief.fromMap(map, selfName, nowMs);
  } else {
    state.belief.ingestMap(map, nowMs);
  }
}

async function cartographerTick(
  env: Env,
  db: Database,
  workerState: ReturnType<typeof createJobState>,
  limiter: TokenBucketRateLimiter,
  selfCache: { value: SelfContext | null },
  agent: AgentState,
  options: CartographerOptions,
): Promise<void> {
  if (workerState.stopped) {
    return;
  }

  const durationMs = options.durationMs ?? Number(process.env.AGENT_DURATION_MS ?? 0);
  if (durationMs > 0 && Date.now() - agent.startedAt >= durationMs) {
    await logJobEvent(db, "info", "cartographer_stop", "agent duration elapsed", {
      durationMs,
    });
    stopJobState(workerState);
    return;
  }

  const client = new GameClient(env, {
    source: "policy",
    policyId: options.policyId ?? "003-cartographer",
    runId: options.runId,
  });

  const schedule = (delayMs: number) =>
    scheduleJobTick(
      workerState,
      () =>
        cartographerTick(env, db, workerState, limiter, selfCache, agent, options),
      delayMs,
    );

  try {
    const self = await resolveSelfContext(db, selfCache);
    const map = await loadMap(db);

    if (!map) {
      await logJobEvent(db, "warn", "cartographer_no_map", "waiting for map snapshot");
      schedule(env.POLL_INTERVAL_MS);
      return;
    }

    const nowMs = Date.now();
    syncMap(agent, map, self.name, nowMs);

    // Poll flags via gateway (audited in api_calls).
    const liveFlags = await fetchFlags(client, env.GAME_ID);
    if (liveFlags.length > 0) {
      agent.flags = liveFlags;
    } else {
      const cached = await readLatestState<FlagsResponse>(db, "flags");
      if (cached?.flags) {
        agent.flags = cached.flags;
      }
    }

    const { owned, occupied, nuked } = buildOwnershipMap(map.tiles, self.name);
    agent.flagOwners = flagOwnersFromMap(agent.flags, occupied);
    agent.flagHunter.observe(agent.flags, agent.flagOwners, nowMs);

    const dryRun = options.dryRun ?? env.DRY_RUN;
    const budget = nextBudgetTick(agent.tickIndex);
    agent.tickIndex += 1;

    // Flag-hunter capture takes priority during attack window.
    const flagPlan = agent.flagHunter.planCapture(
      agent.flags,
      agent.flagOwners,
      owned,
      nowMs,
      new Set(),
    );

    if (flagPlan && !dryRun) {
      const { x, y } = flagPlan.target;
      const k = `${x},${y}`;
      agent.pending.add(k);
      const result = await placeTile(client, limiter, env.GAME_ID, x, y);
      agent.pending.delete(k);
      if (result.ok && self.name) {
        markTileOwned(map, self.name, x, y);
        agent.belief?.noteClaimAccepted(self.name, x, y, nowMs);
        await logJobEvent(db, "info", "cartographer_flag_claim", flagPlan.reason, {
          x,
          y,
        });
      }
      schedule(0);
      return;
    }

    const nukeTarget = agent.flagHunter.planNuke(
      agent.flags,
      agent.flagOwners,
      owned,
    );
    if (nukeTarget && !dryRun && agent.flagHunter.isAttackWindowOpen(nowMs)) {
      const ok = await launchNuke(client, env.GAME_ID, nukeTarget.x, nukeTarget.y);
      if (ok) {
        await logJobEvent(db, "info", "cartographer_nuke", "celebration nuke", {
          x: nukeTarget.x,
          y: nukeTarget.y,
        });
      }
    }

    const belief = agent.belief!;
    const pick = pickCartographerClaim({
      map,
      belief,
      selfName: self.name,
      owned,
      occupied,
      nuked,
      pending: agent.pending,
      lasso: agent.lasso,
      scout: budget.scout,
      nowMs,
    });

    if (!pick) {
      schedule(50);
      return;
    }

    if (dryRun) {
      await logJobEvent(
        db,
        "info",
        "cartographer_dry_run",
        `would ${pick.reason} at ${pick.target.x},${pick.target.y}`,
        { reason: pick.reason, target: pick.target },
      );
      schedule(100);
      return;
    }

    const { x, y } = pick.target;
    const k = `${x},${y}`;
    agent.pending.add(k);
    const result = await placeTile(client, limiter, env.GAME_ID, x, y);
    agent.pending.delete(k);

    if (result.ok) {
      if (self.name) {
        markTileOwned(map, self.name, x, y);
        belief.noteClaimAccepted(self.name, x, y, nowMs);
      }
      limiter.noteRemaining(result.rateLimitRemaining);
      schedule(0);
      return;
    }

    if (result.rateLimited) {
      limiter.pauseFor(
        msUntilRateLimitReset(
          result.rateLimitReset,
          result.rejected?.retry_after,
        ),
      );
      schedule(50);
      return;
    }

    const reason = result.rejected?.reason ?? "";
    if (isOutOfBounds(reason)) {
      excludeOutOfBoundsCell(map, x, y);
      belief.noteOutOfBounds(x, y);
    } else if (isInvalidTarget(reason)) {
      // Learn cell is not claimable — treat as occupied blocker.
      agent.pending.add(k);
      setTimeout(() => agent.pending.delete(k), 5000);
    }

    schedule(10);
  } catch (error) {
    const message = error instanceof Error ? error.message : "cartographer error";
    await logJobEvent(db, "error", "cartographer_error", message);
    schedule(env.POLL_INTERVAL_MS);
  }
}

/** Parallel workers saturating place-tile RPS. */
async function workerLoop(
  env: Env,
  db: Database,
  limiter: TokenBucketRateLimiter,
  selfCache: { value: SelfContext | null },
  agent: AgentState,
  options: CartographerOptions,
  stop: () => boolean,
): Promise<void> {
  const client = new GameClient(env, {
    source: "policy",
    policyId: options.policyId ?? "003-cartographer",
    runId: options.runId,
  });

  while (!stop()) {
    const durationMs = options.durationMs ?? Number(process.env.AGENT_DURATION_MS ?? 0);
    if (durationMs > 0 && Date.now() - agent.startedAt >= durationMs) {
      return;
    }

    const self = await resolveSelfContext(db, selfCache);
    const map = await loadMap(db);
    if (!map || !agent.belief) {
      await new Promise((r) => setTimeout(r, 200));
      continue;
    }

    const nowMs = Date.now();
    syncMap(agent, map, self.name, nowMs);
    const { owned, occupied, nuked } = buildOwnershipMap(map.tiles, self.name);
    const budget = nextBudgetTick(agent.tickIndex++);
    const dryRun = options.dryRun ?? env.DRY_RUN;

    const pick = pickCartographerClaim({
      map,
      belief: agent.belief,
      selfName: self.name,
      owned,
      occupied,
      nuked,
      pending: agent.pending,
      lasso: agent.lasso,
      scout: budget.scout,
      nowMs,
    });

    if (!pick || dryRun) {
      await new Promise((r) => setTimeout(r, 20));
      continue;
    }

    const { x, y } = pick.target;
    const k = `${x},${y}`;
    if (agent.pending.has(k)) {
      continue;
    }
    agent.pending.add(k);
    const result = await placeTile(client, limiter, env.GAME_ID, x, y);
    agent.pending.delete(k);

    if (result.ok && self.name) {
      markTileOwned(map, self.name, x, y);
      agent.belief.noteClaimAccepted(self.name, x, y, nowMs);
      limiter.noteRemaining(result.rateLimitRemaining);
    } else if (result.rateLimited) {
      limiter.pauseFor(
        msUntilRateLimitReset(
          result.rateLimitReset,
          result.rejected?.retry_after,
        ),
      );
    } else {
      const reason = result.rejected?.reason ?? "";
      if (isOutOfBounds(reason)) {
        excludeOutOfBoundsCell(map, x, y);
        agent.belief.noteOutOfBounds(x, y);
      }
    }
  }
}

async function flagPollLoop(
  env: Env,
  db: Database,
  agent: AgentState,
  options: CartographerOptions,
  stop: () => boolean,
): Promise<void> {
  const client = new GameClient(env, {
    source: "policy",
    policyId: options.policyId ?? "003-cartographer",
    runId: options.runId,
  });

  while (!stop()) {
    const durationMs = options.durationMs ?? Number(process.env.AGENT_DURATION_MS ?? 0);
    if (durationMs > 0 && Date.now() - agent.startedAt >= durationMs) {
      return;
    }

    const flags = await fetchFlags(client, env.GAME_ID);
    if (flags.length > 0) {
      agent.flags = flags;
      const map = agent.map ?? (await loadMap(db));
      if (map) {
        const self = await resolveSelfContext(db, { value: null });
        const { occupied } = buildOwnershipMap(map.tiles, self.name);
        agent.flagOwners = flagOwnersFromMap(flags, occupied);
        agent.flagHunter.observe(flags, agent.flagOwners, Date.now());
      }
    }
    await new Promise((r) => setTimeout(r, env.POLL_INTERVAL_MS));
  }
}

export async function startCartographerAgent(
  env: Env,
  db: Database,
  options: CartographerOptions = {},
): Promise<JobHandle> {
  const limiter = await createPlaceTileLimiter(env);
  const workerState = createJobState();
  const selfCache = { value: null as SelfContext | null };

  const agent: AgentState = {
    belief: null,
    lasso: new LassoBandPlanner(),
    flagHunter: new FlagHunter(""),
    map: null,
    tickIndex: 0,
    pending: new Set(),
    startedAt: Date.now(),
    flags: [],
    flagOwners: new Map(),
  };

  await logJobEvent(db, "info", "cartographer_start", "cartographer agent started", {
    durationMs: options.durationMs ?? process.env.AGENT_DURATION_MS ?? null,
    dryRun: options.dryRun ?? env.DRY_RUN,
  });

  const stop = () => workerState.stopped;

  // Resolve self name for flag hunter
  const self = await resolveSelfContext(db, selfCache);
  agent.flagHunter = new FlagHunter(self.name ?? "");

  const workerCount = Math.min(PLACE_TILE_WORKER_COUNT, 20);
  for (let i = 0; i < workerCount; i++) {
    void workerLoop(env, db, limiter, selfCache, agent, options, stop);
  }
  void flagPollLoop(env, db, agent, options, stop);

  // Duration watchdog
  const durationMs = options.durationMs ?? Number(process.env.AGENT_DURATION_MS ?? 0);
  if (durationMs > 0) {
    setTimeout(() => {
      stopJobState(workerState);
    }, durationMs);
  }

  return {
    stop: () => stopJobState(workerState),
  };
}

/** Single-tick runner for policy test / dry-run (no worker pool). */
export async function runCartographerOnce(
  env: Env,
  db: Database,
  options: CartographerOptions = {},
): Promise<void> {
  const limiter = await createPlaceTileLimiter(env);
  const workerState = createJobState();
  const selfCache = { value: null as SelfContext | null };
  const agent: AgentState = {
    belief: null,
    lasso: new LassoBandPlanner(),
    flagHunter: new FlagHunter(""),
    map: null,
    tickIndex: 0,
    pending: new Set(),
    startedAt: Date.now(),
    flags: [],
    flagOwners: new Map(),
  };
  const self = await resolveSelfContext(db, selfCache);
  agent.flagHunter = new FlagHunter(self.name ?? "");

  await cartographerTick(
    env,
    db,
    workerState,
    limiter,
    selfCache,
    agent,
    { ...options, dryRun: true },
  );
}
