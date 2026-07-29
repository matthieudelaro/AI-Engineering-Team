#!/usr/bin/env node
import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { desc, sql } from "drizzle-orm";
import {
  loadEnvConfig,
  loadAbTestConfig,
  loadApiEndpointsConfig,
} from "./config.js";
import { createDb } from "./db/index.js";
import { apiCalls, gameStates, policyRuns } from "./db/schema.js";
import { startGateway, stopGateway } from "./gateway/server.js";
import { startPollers } from "./pollers/runner.js";
import { startJobs } from "./jobs/runner.js";
import {
  PolicySupervisor,
  runPolicyDirect,
  runPolicyTest,
} from "./policies/supervisor.js";

const gameDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function ensureDatabase(): Promise<void> {
  try {
    execSync("docker compose ps --status running postgres", {
      cwd: gameDir,
      stdio: "pipe",
    });
  } catch {
    console.log("starting postgres...");
    execSync("docker compose up -d", {
      cwd: gameDir,
      stdio: "inherit",
    });
  }
  execSync("pnpm db:migrate", {
    cwd: gameDir,
    stdio: "inherit",
  });
}

async function printStatus(): Promise<void> {
  const env = loadEnvConfig();
  const { db, pool } = createDb(env);
  try {
    const calls = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(apiCalls);
    const states = await db
      .select({
        endpointKey: gameStates.endpointKey,
        fetchedAt: gameStates.fetchedAt,
      })
      .from(gameStates)
      .orderBy(desc(gameStates.fetchedAt))
      .limit(5);
    const runs = await db
      .select()
      .from(policyRuns)
      .orderBy(desc(policyRuns.startedAt))
      .limit(10);

    console.log("=== game status ===");
    console.log(`api_calls: ${calls[0]?.count ?? 0}`);
    console.log("recent game_states:");
    for (const state of states) {
      console.log(`  ${state.endpointKey} @ ${state.fetchedAt?.toISOString()}`);
    }
    console.log("policy_runs:");
    for (const run of runs) {
      console.log(
        `  ${run.policyKey} #${run.id} ${run.status} pid=${run.pid ?? "-"}`,
      );
    }
  } finally {
    await pool.end();
  }
}

async function runGatewayCommand(): Promise<void> {
  const env = loadEnvConfig();
  const endpoints = loadApiEndpointsConfig(env);
  const server = await startGateway(env, endpoints);

  const shutdown = async () => {
    await stopGateway(server);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

async function runPollersCommand(): Promise<void> {
  const env = loadEnvConfig();
  const endpoints = loadApiEndpointsConfig(env);
  const { db, pool } = createDb(env);
  const handles = await startPollers(env, db, endpoints);

  const shutdown = async () => {
    for (const handle of handles) {
      handle.stop();
    }
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  await new Promise(() => {});
}

async function runJobsCommand(): Promise<void> {
  const env = loadEnvConfig();
  const { db, pool } = createDb(env);
  const handles = await startJobs(env, db);

  const shutdown = async () => {
    for (const handle of handles) {
      handle.stop();
    }
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  await new Promise(() => {});
}

async function runStartCommand(): Promise<void> {
  await ensureDatabase();
  const env = loadEnvConfig();
  const endpoints = loadApiEndpointsConfig(env);
  const abConfig = loadAbTestConfig();

  const gateway = await startGateway(env, endpoints);
  const { db, pool } = createDb(env);
  const pollerHandles = await startPollers(env, db, endpoints);
  const jobHandles = await startJobs(env, db);
  const supervisor = new PolicySupervisor(env, abConfig);
  await supervisor.startAll();

  console.log("game stack running (gateway + pollers + jobs + policies)");

  const shutdown = async () => {
    await supervisor.stopAll();
    for (const handle of jobHandles) {
      handle.stop();
    }
    for (const handle of pollerHandles) {
      handle.stop();
    }
    await stopGateway(gateway);
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  await new Promise(() => {});
}

async function runPolicyCommand(args: string[]): Promise<void> {
  const subcommand = args[0];
  const policyKey = args[1];
  if (!subcommand || !policyKey) {
    console.error("usage: policy <test|run|restart> <policyKey>");
    process.exit(1);
  }

  const env = loadEnvConfig();
  const abConfig = loadAbTestConfig();

  if (subcommand === "test") {
    await runPolicyTest(policyKey, env, abConfig);
    return;
  }

  if (subcommand === "run") {
    await runPolicyDirect(policyKey, env, abConfig);
    return;
  }

  if (subcommand === "restart") {
    const supervisor = new PolicySupervisor(env, abConfig);
    await supervisor.restartPolicy(policyKey);
    await new Promise(() => {});
    return;
  }

  console.error(`unknown policy subcommand: ${subcommand}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case "gateway":
      await runGatewayCommand();
      break;
    case "pollers":
      await runPollersCommand();
      break;
    case "jobs":
      await runJobsCommand();
      break;
    case "start":
      await runStartCommand();
      break;
    case "status":
      await printStatus();
      break;
    case "policy":
      await runPolicyCommand(args);
      break;
    default:
      console.error(
        "usage: cli.ts <gateway|pollers|jobs|start|status|policy> [args]",
      );
      process.exit(1);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
