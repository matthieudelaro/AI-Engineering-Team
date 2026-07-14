export function isApiErrorPayload(payload: unknown): boolean {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return false;
  }
  const record = payload as Record<string, unknown>;
  return typeof record.error === "string";
}

export function isUsableGameStatePayload(
  endpointKey: string,
  payload: unknown,
): boolean {
  if (isApiErrorPayload(payload)) {
    return false;
  }
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const record = payload as Record<string, unknown>;

  switch (endpointKey) {
    case "leaderboard":
      return Array.isArray(record.entries);
    case "map":
      return (
        Array.isArray(record.tiles) &&
        typeof record.bounds === "object" &&
        record.bounds !== null &&
        !Array.isArray(record.bounds)
      );
    case "flags":
      return Array.isArray(record.flags);
    default:
      return true;
  }
}

export interface CachedStateRowLike {
  payloadJson: unknown;
  fetchedAt: Date | null;
  etagOrHash?: string | null;
}

export function pickUsableCachedRow<T extends CachedStateRowLike>(
  endpointKey: string,
  rows: T[],
): T | null {
  for (const row of rows) {
    if (
      row.payloadJson != null &&
      row.fetchedAt != null &&
      isUsableGameStatePayload(endpointKey, row.payloadJson)
    ) {
      return row;
    }
  }
  return null;
}
