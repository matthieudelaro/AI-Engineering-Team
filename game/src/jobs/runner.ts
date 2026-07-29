import type { Env } from "../config.js";
import type { Database } from "../db/index.js";
import { createPlaceTileLimiter, logJobEvent, type JobHandle } from "./shared.js";
import { startNukeOwnedFlags } from "./nukeOwnedFlags.js";
import { startTileClaimer } from "./tileClaimer.js";

export async function startJobs(env: Env, db: Database): Promise<JobHandle[]> {
  const placeLimiter = await createPlaceTileLimiter(env);
  await logJobEvent(
    db,
    "info",
    "jobs_start",
    "tile claimer + owned-flag nuke loop (flag spawner disabled)",
  );
  return Promise.all([
    startTileClaimer(env, db, placeLimiter),
    startNukeOwnedFlags(env, db),
  ]);
}
