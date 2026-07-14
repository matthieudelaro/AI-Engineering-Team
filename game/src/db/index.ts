import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { Env } from "../config.js";
import * as schema from "./schema.js";

export type Database = ReturnType<typeof createDb>["db"];

export function createDb(env: Env) {
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export async function closeDb(pool: pg.Pool): Promise<void> {
  await pool.end();
}
