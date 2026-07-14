import { logApiCall } from "./apiConsole.js";
import { parseRateLimitHeaders, type RateBudget } from "./rateBudget.js";
import type {
  ActionResponse,
  LeaderboardResponse,
  MapResponse,
  PlayerColors,
} from "./types.js";
import { mapColorForPlayer } from "./playerColors.js";
import { GAME_ID } from "./config.js";

const API_BASE = "/api/v1";

let rateBudget: RateBudget | null = null;

export function bindRateBudget(budget: RateBudget): void {
  rateBudget = budget;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? "GET";
  let response: Response;
  let body: unknown = null;

  try {
    response = await fetch(`${API_BASE}${path}`, {
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
      path,
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
      path,
      status: response.status,
      ok: false,
      body,
      error: detail,
    });
    throw new Error(detail);
  }

  logApiCall({
    method,
    path,
    status: response.status,
    ok: true,
    body,
  });
  return body as T;
}

export function fetchMap(gameId = GAME_ID): Promise<MapResponse> {
  return apiFetch<MapResponse>(`/map?game_id=${encodeURIComponent(gameId)}`);
}

export function fetchLeaderboard(gameId = GAME_ID): Promise<LeaderboardResponse> {
  return apiFetch<LeaderboardResponse>(
    `/leaderboard?game_id=${encodeURIComponent(gameId)}`,
  );
}

export function placeTile(x: number, y: number, gameId = GAME_ID): Promise<ActionResponse> {
  return apiFetch<ActionResponse>("/place-tile", {
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
