/**
 * Standalone entry for the owned-flag nuke job.
 * Prefer `npm run jobs` / `npm start` — those already start this loop.
 */
import { loadEnvConfig } from "../src/config.js";
import { createDb, closeDb } from "../src/db/index.js";
import { startNukeOwnedFlags } from "../src/jobs/nukeOwnedFlags.js";

async function main(): Promise<void> {
  const env = loadEnvConfig();
  const { db, pool } = createDb(env);
  const handle = await startNukeOwnedFlags(env, db);

  const shutdown = async (signal: string) => {
    console.log(`[nuke] shutdown ${signal}`);
    handle.stop();
    await closeDb(pool);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await new Promise(() => {});
}

main().catch((err) => {
  console.error("[nuke] fatal", err);
  process.exit(1);
});
