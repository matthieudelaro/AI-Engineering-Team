import { desc, eq, sql } from "drizzle-orm";
import type { Database } from "../db/index.js";
import { gameStates } from "../db/schema.js";

export interface CachedGameState<T = unknown> {
  endpointKey: string;
  payload: T;
  fetchedAt: string;
  etagOrHash: string | null;
}

export async function readCachedGameState<T = unknown>(
  db: Database,
  endpointKey: string,
): Promise<CachedGameState<T> | null> {
  const rows = await db
    .select()
    .from(gameStates)
    .where(eq(gameStates.endpointKey, endpointKey))
    .orderBy(desc(gameStates.fetchedAt))
    .limit(1);

  const row = rows[0];
  if (!row?.payloadJson || !row.fetchedAt) {
    return null;
  }

  return {
    endpointKey,
    payload: row.payloadJson as T,
    fetchedAt: row.fetchedAt.toISOString(),
    etagOrHash: row.etagOrHash,
  };
}

export async function listCachedGameStates(
  db: Database,
): Promise<Array<{ endpointKey: string; fetchedAt: string }>> {
  const rows = await db.execute<{ endpoint_key: string; fetched_at: Date }>(sql`
    SELECT DISTINCT ON (${gameStates.endpointKey})
      ${gameStates.endpointKey} AS endpoint_key,
      ${gameStates.fetchedAt} AS fetched_at
    FROM ${gameStates}
    ORDER BY ${gameStates.endpointKey}, ${gameStates.fetchedAt} DESC
  `);

  return (rows.rows as Array<{ endpoint_key: string; fetched_at: Date | string }>).map(
    (row) => ({
      endpointKey: row.endpoint_key,
      fetchedAt:
        row.fetched_at instanceof Date
          ? row.fetched_at.toISOString()
          : String(row.fetched_at),
    }),
  );
}
