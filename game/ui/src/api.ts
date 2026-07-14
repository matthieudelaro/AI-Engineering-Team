import { logApiCall } from "./apiConsole.js";
import { GATEWAY_BASE_URL, GAME_ID } from "./config.js";
import { parseRateLimitHeaders, type RateBudget } from "./rateBudget.js";
import type {
  ActionResponse,
  FlagsResponse,
  LeaderboardResponse,
  MapResponse,
  PlayerColors,
} from "./types.js";
import { mapColorForPlayer } from "./playerColors.js";
import { GAME_ID } from "./config.js";
import { formatCacheAge } from "./cacheAge.js";

export { formatCacheAge } from "./cacheAge.js";

const GAME_API_BASE = `${GATEWAY_BASE_URL}/api/v1`;

let rateBudget: RateBudget | null = null;

export interface CachedReadMeta {
  fetchedAt: string | null;
  source: "postgres";
}

export function bindRateBudget(budget: RateBudget): void {
  rateBudget = budget;
}

function gatewayUrl(path: string): string {
  return `${GATEWAY_BASE_URL}${path}`;
}

/** Read latest poller snapshot from postgres via gateway — never hits the game API. */
async function readCachedState<T>(
  endpointKey: string,
): Promise<{ data: T; meta: CachedReadMeta }> {
  const path = `/_gateway/state/${endpointKey}`;
  const url = gatewayUrl(path);
  let response: Response;
  let body: unknown = null;

  try {
    response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        "X-Source": "ui",
      },
    });
    const text = await response.text();
    if (text) {
      body = JSON.parse(text) as unknown;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "cache read failed";
    logApiCall({
      method: "GET",
      path: `${path} (postgres cache)`,
      status: 0,
      ok: false,
      body: null,
      error: message,
    });
    throw error;
  }

  const fetchedAt = response.headers.get("x-state-fetched-at");

  if (!response.ok) {
    const detail =
      typeof body === "object" && body !== null && "message" in body
        ? String((body as { message: string }).message)
        : response.statusText;
    logApiCall({
      method: "GET",
      path: `${path} (postgres cache)`,
      status: response.status,
      ok: false,
      body,
      error: detail,
      fetchedAt,
    });
    throw new Error(detail);
  }

  logApiCall({
    method: "GET",
    path: `${path} (postgres cache)`,
    status: response.status,
    ok: true,
    body,
    fetchedAt,
  });

  return {
    data: body as T,
    meta: { fetchedAt, source: "postgres" },
  };
}

async function postGameAction<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? "GET";
  let response: Response;
  let body: unknown = null;

  try {
    response = await fetch(`${GAME_API_BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-Source": "ui",
        ...init?.headers,
      },
    });
    if (method === "POST" && path.includes("/place-tile")) {
      rateBudget?.onPlaceTileResponse(parseRateLimitHeaders(response));
    }
    const text = await response.text();
    if (text) {
      body = JSON.parse(text) as unknown;
    }
  } catch (error) {
    if (method === "POST" && path.includes("/place-tile")) {
      rateBudget?.onPlaceTileError();
    }
    const message = error instanceof Error ? error.message : "request failed";
    logApiCall({
      method,
      path: `/api/v1${path} (game API)`,
      status: 0,
      ok: false,
      body: null,
      error: message,
    });
    throw error;
  }

  if (!response.ok) {
    const detail =
      typeof body === "object" && body !== null && "details" in body
        ? String((body as { details: string }).details)
        : response.statusText;
    logApiCall({
      method,
      path: `/api/v1${path} (game API)`,
      status: response.status,
      ok: false,
      body,
      error: detail,
    });
    throw new Error(detail);
  }

  logApiCall({
    method,
    path: `/api/v1${path} (game API)`,
    status: response.status,
    ok: true,
    body,
  });
  return body as T;
}

export function mapStreamUrl(): string {
  return `${GATEWAY_BASE_URL}/api/v1/games/${GAME_ID}/map/stream`;
}

export function fetchMap(): Promise<{ data: MapResponse; meta: CachedReadMeta }> {
  return readCachedState<MapResponse>("map");
}

export function fetchLeaderboard(): Promise<{
  data: LeaderboardResponse;
  meta: CachedReadMeta;
}> {
  return readCachedState<LeaderboardResponse>("leaderboard");
}

export function fetchFlags(): Promise<{ data: FlagsResponse; meta: CachedReadMeta }> {
  return readCachedState<FlagsResponse>("flags");
}

export function placeTile(x: number, y: number, gameId = GAME_ID): Promise<ActionResponse> {
  return postGameAction<ActionResponse>("/place-tile", {
    method: "POST",
    body: JSON.stringify({ x, y, game_id: gameId }),
  });
}

export function ownershipName(
  ownership: string | Record<string, unknown>,
): string | null {
  if (typeof ownership === "string") {
    if (ownership === "" || ownership === "neutral") {
      return null;
    }
    return ownership;
  }
  if (typeof ownership === "object" && ownership !== null) {
    for (const key of ["display_name", "owned", "name"]) {
      const value = ownership[key];
      if (typeof value === "string" && value !== "" && value !== "neutral") {
        return value;
      }
    }
  }
  return null;
}

/** Player color from tile ownership object, else resolved leaderboard color. */
export function ownershipColor(
  ownership: string | Record<string, unknown>,
  colors: PlayerColors,
): string | null {
  if (typeof ownership === "object" && ownership !== null) {
    const direct = ownership["color"];
    if (typeof direct === "string" && direct !== "") {
      return direct;
    }
  }

  const owner = ownershipName(ownership);
  if (!owner) {
    return null;
  }
  return mapColorForPlayer(owner, colors);
}
