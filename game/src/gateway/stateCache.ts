import { desc, eq } from "drizzle-orm";
import type { Database } from "../db/index.js";
import { gameStates } from "../db/schema.js";
import { pickUsableCachedRow } from "../state/usablePayload.js";

export interface CachedGameState<T = unknown> {
  endpointKey: string;
  payload: T;
  fetchedAt: string;
  etagOrHash: string | null;
}

const WALK_BACK_LIMIT = 20;

export async function readCachedGameState<T = unknown>(
  db: Database,
  endpointKey: string,
): Promise<CachedGameState<T> | null> {
  const rows = await db
    .select()
    .from(gameStates)
    .where(eq(gameStates.endpointKey, endpointKey))
    .orderBy(desc(gameStates.fetchedAt))
    .limit(WALK_BACK_LIMIT);

  const row = pickUsableCachedRow(endpointKey, rows);
  if (!row?.payloadJson || !row.fetchedAt) {
    return null;
  }

  return {
    endpointKey,
    payload: row.payloadJson as T,
    fetchedAt: row.fetchedAt.toISOString(),
    etagOrHash: row.etagOrHash ?? null,
  };
}

export async function listCachedGameStates(
  db: Database,
): Promise<Array<{ endpointKey: string; fetchedAt: string }>> {
  const keys = await db
    .selectDistinct({ endpointKey: gameStates.endpointKey })
    .from(gameStates);

  const result: Array<{ endpointKey: string; fetchedAt: string }> = [];

  for (const { endpointKey } of keys) {
    const rows = await db
      .select()
      .from(gameStates)
      .where(eq(gameStates.endpointKey, endpointKey))
      .orderBy(desc(gameStates.fetchedAt))
      .limit(WALK_BACK_LIMIT);

    const usable = pickUsableCachedRow(endpointKey, rows);
    if (usable?.fetchedAt) {
      result.push({
        endpointKey,
        fetchedAt: usable.fetchedAt.toISOString(),
      });
    }
  }

  return result.sort((a, b) => a.endpointKey.localeCompare(b.endpointKey));
}
