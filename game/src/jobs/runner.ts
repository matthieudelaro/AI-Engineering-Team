import type { Env } from "../config.js";
import type { Database } from "../db/index.js";
import { startFlagSpawner } from "./flagSpawner.js";
import { createPlaceTileLimiter, type JobHandle } from "./shared.js";
import { startTileClaimer } from "./tileClaimer.js";

export async function startJobs(env: Env, db: Database): Promise<JobHandle[]> {
  const placeLimiter = await createPlaceTileLimiter(env);
  return Promise.all([
    startFlagSpawner(env, db, placeLimiter),
    startTileClaimer(env, db, placeLimiter),
  ]);
}
