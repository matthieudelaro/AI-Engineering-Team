import { GameClient } from "../client/gameClient.js";

export interface ActionLimit {
  max_per_sec?: number | null;
  cooldown?: number | null;
}

export interface MethodLimitsResponse {
  place_tile?: ActionLimit | null;
  get_map?: ActionLimit | null;
  get_flags?: ActionLimit | null;
  get_leaderboard?: ActionLimit | null;
  get_stats?: ActionLimit | null;
}

const ENDPOINT_LIMIT_KEYS: Record<string, keyof MethodLimitsResponse> = {
  map: "get_map",
  flags: "get_flags",
  leaderboard: "get_leaderboard",
};

export function resolveEndpointLimitKey(
  endpointKey: string,
  limitKey?: string,
): keyof MethodLimitsResponse | undefined {
  if (limitKey) {
    return limitKey as keyof MethodLimitsResponse;
  }
  return ENDPOINT_LIMIT_KEYS[endpointKey];
}

export function maxPerSecForEndpoint(
  limits: MethodLimitsResponse | null,
  endpointKey: string,
  limitKey?: string,
  configuredMax?: number,
  fallback = 2,
): number {
  if (configuredMax !== undefined) {
    return configuredMax;
  }
  const key = resolveEndpointLimitKey(endpointKey, limitKey);
  if (key && limits?.[key]?.max_per_sec) {
    return limits[key]!.max_per_sec!;
  }
  return fallback;
}

export function pollIntervalMsForRps(maxPerSec: number): number {
  return Math.max(50, Math.ceil(1000 / maxPerSec));
}

export async function fetchMethodLimits(
  client: GameClient,
  gameId: string,
): Promise<MethodLimitsResponse | null> {
  const response = await client.get(
    `/api/v1/method-limits?game_id=${encodeURIComponent(gameId)}`,
  );
  if (response.status !== 200) {
    return null;
  }
  return response.json() as MethodLimitsResponse;
}
