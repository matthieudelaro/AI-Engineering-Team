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
  // One row at a time — avoids loading multi‑MB prior-game snapshots in a batch.
  for (let offset = 0; offset < WALK_BACK_LIMIT; offset += 1) {
    const rows = await db
      .select()
      .from(gameStates)
      .where(eq(gameStates.endpointKey, endpointKey))
      .orderBy(desc(gameStates.fetchedAt))
      .limit(1)
      .offset(offset);

    if (rows.length === 0) {
      return null;
    }

    const row = pickUsableCachedRow(endpointKey, rows);
    if (!row?.payloadJson || !row.fetchedAt) {
      continue;
    }

    return {
      endpointKey,
      payload: row.payloadJson as T,
      fetchedAt: row.fetchedAt.toISOString(),
      etagOrHash: row.etagOrHash ?? null,
    };
  }

  return null;
}

export async function listCachedGameStates(
  db: Database,
): Promise<Array<{ endpointKey: string; fetchedAt: string }>> {
  const keys = await db
    .selectDistinct({ endpointKey: gameStates.endpointKey })
    .from(gameStates);

  const result: Array<{ endpointKey: string; fetchedAt: string }> = [];

  for (const { endpointKey } of keys) {
    // Metadata only — never pull payload_json for the listing endpoint.
    const rows = await db
      .select({
        fetchedAt: gameStates.fetchedAt,
        etagOrHash: gameStates.etagOrHash,
      })
      .from(gameStates)
      .where(eq(gameStates.endpointKey, endpointKey))
      .orderBy(desc(gameStates.fetchedAt))
      .limit(1);

    const fetchedAt = rows[0]?.fetchedAt;
    if (fetchedAt) {
      result.push({
        endpointKey,
        fetchedAt: fetchedAt.toISOString(),
      });
    }
  }

  return result.sort((a, b) => a.endpointKey.localeCompare(b.endpointKey));
}
