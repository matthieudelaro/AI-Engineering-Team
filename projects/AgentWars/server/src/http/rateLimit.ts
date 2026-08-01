export type RateLimitEndpoint =
  | "place_tile"
  | "get_map"
  | "get_flags"
  | "get_leaderboard"
  | "launch_nuke"
  | "get_stats";

export const RATE_LIMITS: Record<RateLimitEndpoint, number> = {
  place_tile: 20,
  get_map: 30,
  get_flags: 20,
  get_leaderboard: 20,
  launch_nuke: 1,
  get_stats: 20,
};

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  reset: number;
  retryAfter: number;
}

interface WindowState {
  count: number;
  resetAt: number;
}

const windows = new Map<string, WindowState>();

function windowKey(playerId: string, endpoint: RateLimitEndpoint): string {
  return `${playerId}:${endpoint}`;
}

function isDisabled(): boolean {
  return process.env.RATE_LIMIT_DISABLED === "1";
}

export function checkRateLimit(
  playerId: string,
  endpoint: RateLimitEndpoint,
  now = Date.now(),
): RateLimitResult {
  const limit = RATE_LIMITS[endpoint];
  if (isDisabled()) {
    const reset = Math.ceil(now / 1000) + 1;
    return {
      allowed: true,
      limit,
      remaining: limit,
      reset,
      retryAfter: 0,
    };
  }

  const key = windowKey(playerId, endpoint);
  const currentSecond = Math.floor(now / 1000);
  let state = windows.get(key);

  if (!state || state.resetAt <= currentSecond) {
    state = { count: 0, resetAt: currentSecond + 1 };
    windows.set(key, state);
  }

  const allowed = state.count < limit;
  if (allowed) {
    state.count += 1;
  }

  const remaining = Math.max(0, limit - state.count);
  return {
    allowed,
    limit,
    remaining,
    reset: state.resetAt,
    retryAfter: allowed ? 0 : state.resetAt - currentSecond,
  };
}

export function rateLimitHeaders(
  result: RateLimitResult,
): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(result.reset),
  };
}

export function clearRateLimitsForTests(): void {
  windows.clear();
}
