/**
 * Long-running job: nuke active flags on OUR tiles only.
 * Target selection reads cached map/flags from Postgres (pollers).
 * Only launch-nuke hits the game API via the gateway.
 *
 * Spend cap: NUKE_RATE_LIMIT points (default 100) per rolling
 * NUKE_RATE_WINDOW_MS (default 3 minutes).
 */
import type { Env } from "../config.js";
import { GameClient } from "../client/gameClient.js";
import type { Database } from "../db/index.js";
import {
  loadMap,
  logJobEvent,
  ownerName,
  readLatestState,
  type JobHandle,
} from "./shared.js";

/** Max points charged across the rolling window. */
const RATE_LIMIT = Number(process.env.NUKE_RATE_LIMIT ?? 100);
/** Rolling window length (default 3 minutes). */
const RATE_WINDOW_MS = Number(
  process.env.NUKE_RATE_WINDOW_MS ?? 3 * 60 * 1000,
);
/** Do not start a shot unless at least this much room remains in the window. */
const MIN_SHOT_ROOM = Number(process.env.NUKE_MIN_SHOT_BUDGET ?? 5);
const COOLDOWN_MS = 30_000;
const IDLE_MS = 5_000;
const LONG_IDLE_MS = 60_000;
const SELF_FALLBACK = "manual-assisted-by-computer";

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

interface LeaderboardEntry {
  display_name: string;
  is_self?: boolean;
  score_streams?: Record<string, number>;
}

function key(x: number, y: number): string {
  return `${x},${y}`;
}

function sleep(ms: number, isStopped: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (isStopped() || Date.now() - started >= ms) {
        resolve();
        return;
      }
      setTimeout(tick, Math.min(250, ms - (Date.now() - started)));
    };
    setTimeout(tick, Math.min(250, ms));
  });
}

async function resolveSelfName(db: Database): Promise<string> {
  const lb = await readLatestState<{ entries: LeaderboardEntry[] }>(
    db,
    "leaderboard",
  );
  const self = lb?.entries?.find((e) => e.is_self);
  return self?.display_name ?? SELF_FALLBACK;
}

async function readSelfNukeCost(db: Database): Promise<number | null> {
  const lb = await readLatestState<{ entries: LeaderboardEntry[] }>(
    db,
    "leaderboard",
  );
  const self = lb?.entries?.find((e) => e.is_self);
  const v = self?.score_streams?.nuke_cost;
  return typeof v === "number" ? v : null;
}

function ownedFlagTargets(
  map: Awaited<ReturnType<typeof loadMap>>,
  flags: FlagInfo[] | undefined,
  selfName: string,
  skip: Set<string>,
): FlagInfo[] {
  if (!map?.tiles?.length || !flags?.length) {
    return [];
  }
  const owned = new Set<string>();
  for (const t of map.tiles) {
    if (ownerName(t.ownership) === selfName) {
      owned.add(key(t.x, t.y));
    }
  }
  return flags
    .filter(
      (f) =>
        !f.nuked &&
        owned.has(key(f.x, f.y)) &&
        !skip.has(key(f.x, f.y)),
    )
    .sort(
      (a, b) =>
        a.pot - b.pot ||
        Math.abs(a.x) + Math.abs(a.y) - (Math.abs(b.x) + Math.abs(b.y)),
    );
}

async function runLoop(
  env: Env,
  db: Database,
  isStopped: () => boolean,
): Promise<void> {
  const client = new GameClient(env, { source: "job" });
  let selfName = SELF_FALLBACK;
  const window: Array<{ t: number; cost: number }> = [];
  const skip = new Set<string>();
  let lastNukeCostStream: number | null = null;
  let shots = 0;
  let lifetimeSpent = 0;

  const pruneWindow = (now: number): number => {
    while (window.length && now - window[0]!.t >= RATE_WINDOW_MS) {
      window.shift();
    }
    return window.reduce((s, w) => s + w.cost, 0);
  };

  try {
    selfName = await resolveSelfName(db);
  } catch (err) {
    console.log(`[nuke] self resolve failed: ${err}; using ${SELF_FALLBACK}`);
  }

  console.log(
    `[nuke] owned-flags loop | self=${selfName} rate=${RATE_LIMIT}pts / ${RATE_WINDOW_MS}ms (${RATE_WINDOW_MS / 60000}min)`,
  );
  await logJobEvent(
    db,
    "info",
    "nuke_loop_start",
    `owned-flag nuke loop start self=${selfName} rate=${RATE_LIMIT}/${RATE_WINDOW_MS}ms`,
  );

  while (!isStopped()) {
    try {
      const streamCost = await readSelfNukeCost(db);
      if (
        streamCost !== null &&
        lastNukeCostStream !== null &&
        Math.abs(streamCost) < 1 &&
        Math.abs(lastNukeCostStream) >= 1
      ) {
        console.log(
          `[nuke] reset nuke_cost ${lastNukeCostStream}→${streamCost}; clear window/skips`,
        );
        skip.clear();
        window.length = 0;
      }
      if (streamCost !== null) {
        lastNukeCostStream = streamCost;
      }

      const map = await loadMap(db);
      const flagsState = await readLatestState<FlagsResponse>(db, "flags");
      try {
        selfName = await resolveSelfName(db);
      } catch {
        /* keep previous */
      }
      const targets = ownedFlagTargets(
        map,
        flagsState?.flags,
        selfName,
        skip,
      );

      if (targets.length === 0) {
        if (skip.size > 0 && (!flagsState?.flags?.length || skip.size > 50)) {
          skip.clear();
        }
        console.log(`[nuke] idle: no owned active flags in cache`);
        await sleep(IDLE_MS, isStopped);
        continue;
      }

      const now = Date.now();
      const windowSum = pruneWindow(now);
      const room = RATE_LIMIT - windowSum;
      if (room < MIN_SHOT_ROOM) {
        const wait = RATE_WINDOW_MS - (now - window[0]!.t) + 200;
        console.log(
          `[nuke] rate ${windowSum}/${RATE_LIMIT} in last ${RATE_WINDOW_MS / 1000}s; wait ${Math.round(wait / 1000)}s`,
        );
        await sleep(Math.max(IDLE_MS, wait), isStopped);
        continue;
      }

      const f = targets[0]!;
      console.log(
        `[nuke] shot OWNED (${f.x},${f.y}) pot=${f.pot} | left=${targets.length} window=${windowSum}/${RATE_LIMIT}`,
      );

      let res: Awaited<ReturnType<typeof client.post>>;
      try {
        res = await client.post("/api/v1/launch-nuke", {
          game_id: env.GAME_ID,
          target_x: f.x,
          target_y: f.y,
        });
      } catch (err) {
        console.log(`[nuke] gateway error: ${err}; retry in ${IDLE_MS}ms`);
        await sleep(IDLE_MS, isStopped);
        continue;
      }

      let body: {
        accepted?: {
          effect?: { cost_charged?: number; effective_radius_tiles?: number };
        };
        rejected?: {
          reason?: string;
          retry_after?: number;
          insufficient_points?: { cost?: number; available?: number };
        };
      } = {};
      try {
        body = res.json() as typeof body;
      } catch {
        /* empty */
      }
      console.log(`[nuke] status=${res.status} body=${res.body.slice(0, 280)}`);

      if (res.status === 200 && body.accepted) {
        const cost = Number(body.accepted.effect?.cost_charged ?? 0);
        const radius = body.accepted.effect?.effective_radius_tiles;
        shots += 1;
        lifetimeSpent += cost;
        window.push({ t: Date.now(), cost });
        const after = pruneWindow(Date.now());
        console.log(
          `[nuke] OK cost=${cost} radius=${radius} window=${after}/${RATE_LIMIT} lifetime=${lifetimeSpent}`,
        );
        try {
          await logJobEvent(
            db,
            "info",
            "nuke_ok",
            `nuked owned (${f.x},${f.y})`,
            { cost, radius, windowSum: after, lifetimeSpent, pot: f.pot },
          );
        } catch {
          /* ignore */
        }
        if (RATE_LIMIT - after < MIN_SHOT_ROOM) {
          const wait = RATE_WINDOW_MS - (Date.now() - window[0]!.t) + 200;
          console.log(
            `[nuke] cap hit (${after}/${RATE_LIMIT}); wait ${Math.round(wait / 1000)}s`,
          );
          await sleep(Math.max(COOLDOWN_MS, wait), isStopped);
          continue;
        }
        await sleep(COOLDOWN_MS, isStopped);
        continue;
      }

      const rejected = body.rejected;
      const reason = rejected?.reason ?? "";
      const retrySec = Number(rejected?.retry_after ?? 0);

      if (reason === "REJECTION_REASON_GAME_ENDED" || res.status === 410) {
        console.log(`[nuke] game ended; long idle`);
        await sleep(LONG_IDLE_MS, isStopped);
        continue;
      }

      if (
        res.status === 429 ||
        reason === "REJECTION_REASON_RATE_LIMITED" ||
        reason === "REJECTION_REASON_COOLDOWN"
      ) {
        const waitMs = Math.max(retrySec * 1000, COOLDOWN_MS);
        console.log(`[nuke] wait ${waitMs}ms (${reason || res.status})`);
        await sleep(waitMs, isStopped);
        continue;
      }

      if (rejected?.insufficient_points) {
        console.log(
          `[nuke] insufficient points ${JSON.stringify(rejected.insufficient_points)}; long idle`,
        );
        await sleep(LONG_IDLE_MS, isStopped);
        continue;
      }

      if (
        reason === "REJECTION_REASON_INVALID_ARGUMENT" ||
        reason === "REJECTION_REASON_INVALID_TARGET" ||
        res.status === 400 ||
        res.status === 404
      ) {
        skip.add(key(f.x, f.y));
        console.log(`[nuke] skip (${f.x},${f.y}) reason=${reason || res.status}`);
        await sleep(1_000, isStopped);
        continue;
      }

      console.log(`[nuke] other reject; idle`);
      await sleep(IDLE_MS, isStopped);
    } catch (err) {
      console.log(`[nuke] loop-error ${err}; idle`);
      await sleep(IDLE_MS, isStopped);
    }
  }

  const windowSum = pruneWindow(Date.now());
  await logJobEvent(
    db,
    "info",
    "nuke_loop_stop",
    `stopped window=${windowSum} shots=${shots}`,
    { windowSum, shots, lifetimeSpent },
  );
  console.log(
    `[nuke] stopped window=${windowSum}/${RATE_LIMIT} shots=${shots} lifetime=${lifetimeSpent}`,
  );
}

export async function startNukeOwnedFlags(
  env: Env,
  db: Database,
): Promise<JobHandle> {
  let stopped = false;
  const isStopped = () => stopped;

  void runLoop(env, db, isStopped).catch((err) => {
    console.error("[nuke] fatal", err);
  });

  return {
    stop: () => {
      stopped = true;
    },
  };
}
