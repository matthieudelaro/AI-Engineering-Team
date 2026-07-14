import { desc, eq } from "drizzle-orm";
import type { Env, Zone } from "../config.js";
import { GameClient } from "../client/gameClient.js";
import { createDb } from "../db/index.js";
import { gameStates, policyEvents, policyRuns } from "../db/schema.js";
import { loadPolicy } from "./loader.js";
import type { Policy, PolicyContext, PolicyRunOptions } from "./types.js";

function buildContext(
  env: Env,
  db: ReturnType<typeof createDb>["db"],
  policyKey: string,
  runId: number,
  zone: Zone | undefined,
  dryRun: boolean,
): PolicyContext {
  const client = new GameClient(env, {
    policyId: policyKey,
    runId,
    source: "policy",
  });

  return {
    policyKey,
    runId,
    gameId: env.GAME_ID,
    zone,
    dryRun,
    client,
    db,
    logEvent: async (level, eventType, message, data) => {
      await db.insert(policyEvents).values({
        runId,
        level,
        eventType,
        message,
        dataJson: data ?? null,
        source: "policy",
      });
    },
    getLatestState: async (endpointKey) => {
      const rows = await db
        .select()
        .from(gameStates)
        .where(eq(gameStates.endpointKey, endpointKey))
        .orderBy(desc(gameStates.fetchedAt))
        .limit(1);
      const row = rows[0];
      return row?.payloadJson ?? null;
    },
  };
}

export async function runPolicyLoop(
  options: PolicyRunOptions,
  env: Env,
): Promise<void> {
  const policy = await loadPolicy(options.policyKey);
  const zone = options.zone ?? policy.zone;
  const dryRun = options.dryRun ?? env.DRY_RUN;
  const maxTicks = options.maxTicks;

  const { db, pool } = createDb(env);
  const [run] = await db
    .insert(policyRuns)
    .values({
      policyKey: options.policyKey,
      zoneJson: zone ?? null,
      status: "running",
      configJson: { dryRun, maxTicks: maxTicks ?? null },
      pid: process.pid,
    })
    .returning();

  if (!run) {
    await pool.end();
    throw new Error("failed to create policy run");
  }

  const ctx = buildContext(env, db, options.policyKey, run.id, zone, dryRun);

  try {
    await ctx.logEvent("info", "run_start", `policy ${options.policyKey} started`, {
      zone,
      dryRun,
      pid: process.pid,
    });

    if (policy.onStart) {
      await policy.onStart(ctx);
    }

    let ticks = 0;
    while (maxTicks === undefined || ticks < maxTicks) {
      await policy.tick(ctx);
      ticks += 1;
      if (maxTicks === undefined) {
        await new Promise((resolve) =>
          setTimeout(resolve, env.POLICY_TICK_INTERVAL_MS),
        );
      }
    }

    await db
      .update(policyRuns)
      .set({ status: "completed", stoppedAt: new Date() })
      .where(eq(policyRuns.id, run.id));
    await ctx.logEvent("info", "run_complete", `policy ${options.policyKey} completed`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    await ctx.logEvent("error", "run_error", message);
    await db
      .update(policyRuns)
      .set({ status: "failed", stoppedAt: new Date() })
      .where(eq(policyRuns.id, run.id));
    throw error;
  } finally {
    if (policy.onStop) {
      await policy.onStop(ctx);
    }
    await pool.end();
  }
}
