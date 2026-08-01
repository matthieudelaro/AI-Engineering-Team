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

function updateFlagOwners(agent: AgentState, occupied: Map<string, string | null>): void {
  agent.flagOwners = flagOwnersFromMap(agent.flags, occupied);
}

type PlaceTileAction =
  | { kind: "flag_claim"; x: number; y: number; reason: string }
  | { kind: "territory_claim"; x: number; y: number; reason: string };

/**
 * Shared action picker for live workers: flag capture during attack window
 * takes priority over lasso/scout/fallback territory claims.
 */
export function pickPlaceTileAction(
  agent: AgentState,
  map: MapResponse,
  selfName: string | null,
  owned: Set<string>,
  occupied: Map<string, string | null>,
  nuked: Set<string>,
  nowMs: number,
): PlaceTileAction | null {
  updateFlagOwners(agent, occupied);
  agent.flagHunter.observe(agent.flags, agent.flagOwners, nowMs);

  const enemiesWithNuke = agent.flagHunter.inferEnemiesWithNuke(
    agent.flags,
    agent.flagOwners,
    nowMs,
  );
  const flagPlan = agent.flagHunter.planCapture(
    agent.flags,
    agent.flagOwners,
    owned,
    nowMs,
    enemiesWithNuke,
  );
  if (flagPlan) {
    const k = `${flagPlan.target.x},${flagPlan.target.y}`;
    if (!agent.pending.has(k)) {
      return {
        kind: "flag_claim",
        x: flagPlan.target.x,
        y: flagPlan.target.y,
        reason: flagPlan.reason,
      };
    }
  }

  const budget = nextBudgetTick(agent.tickIndex++);
  const belief = agent.belief;
  if (!belief) {
    return null;
  }

  const pick = pickCartographerClaim({
    map,
    belief,
    selfName,
    owned,
    occupied,
    nuked,
    pending: agent.pending,
    lasso: agent.lasso,
    scout: budget.scout,
    nowMs,
  });
  if (!pick) {
    return null;
  }
  const k = `${pick.target.x},${pick.target.y}`;
  if (agent.pending.has(k)) {
    return null;
  }
  return {
    kind: "territory_claim",
    x: pick.target.x,
    y: pick.target.y,
    reason: pick.reason,
  };
}

async function applyPlaceTileResult(
  result: Awaited<ReturnType<typeof placeTile>>,
  limiter: TokenBucketRateLimiter,
  map: MapResponse,
  belief: MapBelief,
  selfName: string | null,
  pending: Set<string>,
  x: number,
  y: number,
  nowMs: number,
): Promise<void> {
  if (result.ok) {
    if (selfName) {
      markTileOwned(map, selfName, x, y);
      belief.noteClaimAccepted(selfName, x, y, nowMs);
    }
    limiter.noteRemaining(result.rateLimitRemaining);
    return;
  }
  if (result.rateLimited) {
    limiter.pauseFor(
      msUntilRateLimitReset(
        result.rateLimitReset,
        result.rejected?.retry_after,
      ),
    );
    return;
  }
  const reason = result.rejected?.reason ?? "";
  if (isOutOfBounds(reason)) {
    excludeOutOfBoundsCell(map, x, y);
    belief.noteOutOfBounds(x, y);
  } else if (isInvalidTarget(reason)) {
    const k = `${x},${y}`;
    pending.add(k);
    setTimeout(() => pending.delete(k), 5000);
  }
}

/** Parallel workers saturating place-tile RPS (flag capture + territory). */
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
    if (!map) {
      await new Promise((r) => setTimeout(r, 200));
      continue;
    }

    const nowMs = Date.now();
    // Must sync before the belief guard — otherwise workers spin forever with
    // belief === null and never place tiles.
    syncMap(agent, map, self.name, nowMs);
    if (!agent.belief) {
      await new Promise((r) => setTimeout(r, 200));
      continue;
    }
    const { owned, occupied, nuked } = buildOwnershipMap(map.tiles, self.name);
    const dryRun = options.dryRun ?? env.DRY_RUN;

    const action = pickPlaceTileAction(
      agent,
      map,
      self.name,
      owned,
      occupied,
      nuked,
      nowMs,
    );

    if (!action || dryRun) {
      await new Promise((r) => setTimeout(r, 20));
      continue;
    }

    const { x, y } = action;
    const k = `${x},${y}`;
    agent.pending.add(k);
    const result = await placeTile(client, limiter, env.GAME_ID, x, y);
    agent.pending.delete(k);

    if (result.ok && action.kind === "flag_claim") {
      await logJobEvent(db, "info", "cartographer_flag_claim", action.reason, {
        x,
        y,
      });
    }

    await applyPlaceTileResult(
      result,
      limiter,
      map,
      agent.belief,
      self.name,
      agent.pending,
      x,
      y,
      nowMs,
    );
  }
}

/**
 * Polls flags via gateway and executes celebration nukes when we own a stolen
 * enemy flag during an attack window.
 */
async function flagLoop(
  env: Env,
  db: Database,
  agent: AgentState,
  options: CartographerOptions,
  selfCache: { value: SelfContext | null },
  stop: () => boolean,
): Promise<void> {
  const client = new GameClient(env, {
    source: "policy",
    policyId: options.policyId ?? "003-cartographer",
    runId: options.runId,
  });
  const dryRun = options.dryRun ?? env.DRY_RUN;

  while (!stop()) {
    const durationMs = options.durationMs ?? Number(process.env.AGENT_DURATION_MS ?? 0);
    if (durationMs > 0 && Date.now() - agent.startedAt >= durationMs) {
      return;
    }

    const nowMs = Date.now();
    const flags = await fetchFlags(client, env.GAME_ID);
    if (flags.length > 0) {
      agent.flags = flags;
    } else {
      const cached = await readLatestState<FlagsResponse>(db, "flags");
      if (cached?.flags) {
        agent.flags = cached.flags;
      }
    }

    const map = agent.map ?? (await loadMap(db));
    if (map && agent.flags.length > 0) {
      const self = await resolveSelfContext(db, selfCache);
      const { owned, occupied } = buildOwnershipMap(map.tiles, self.name);
      updateFlagOwners(agent, occupied);
      agent.flagHunter.observe(agent.flags, agent.flagOwners, nowMs);

      if (agent.flagHunter.isAttackWindowOpen(nowMs) && !dryRun) {
        const nukeTarget = agent.flagHunter.planNuke(
          agent.flags,
          agent.flagOwners,
          owned,
        );
        if (nukeTarget) {
          const ok = await launchNuke(
            client,
            env.GAME_ID,
            nukeTarget.x,
            nukeTarget.y,
          );
          if (ok) {
            await logJobEvent(db, "info", "cartographer_nuke", "celebration nuke", {
              x: nukeTarget.x,
              y: nukeTarget.y,
              flagId: nukeTarget.flagId,
            });
          }
        }
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

  const self = await resolveSelfContext(db, selfCache);
  agent.flagHunter = new FlagHunter(self.name ?? "");

  const workerCount = Math.min(PLACE_TILE_WORKER_COUNT, 20);
  for (let i = 0; i < workerCount; i++) {
    void workerLoop(env, db, limiter, selfCache, agent, options, stop);
  }
  void flagLoop(env, db, agent, options, selfCache, stop);

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

/** Test helper — builds minimal agent state for pickPlaceTileAction. */
export function pickPlaceTileActionForTest(input: {
  belief: MapBelief;
  lasso: LassoBandPlanner;
  flagHunter: FlagHunter;
  flags: FlagInfo[];
  flagOwners: Map<string, string | null>;
  map: MapResponse;
  selfName: string | null;
  owned: Set<string>;
  occupied: Map<string, string | null>;
  nuked: Set<string>;
  pending: Set<string>;
  tickIndex: number;
  nowMs: number;
}): PlaceTileAction | null {
  const agent: AgentState = {
    belief: input.belief,
    lasso: input.lasso,
    flagHunter: input.flagHunter,
    map: input.map,
    tickIndex: input.tickIndex,
    pending: input.pending,
    startedAt: 0,
    flags: input.flags,
    flagOwners: input.flagOwners,
  };
  return pickPlaceTileAction(
    agent,
    input.map,
    input.selfName,
    input.owned,
    input.occupied,
    input.nuked,
    input.nowMs,
  );
}
