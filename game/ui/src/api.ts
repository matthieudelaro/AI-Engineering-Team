import { logApiCall } from "./apiConsole.js";
import { GATEWAY_BASE_URL, GAME_ID } from "./config.js";
import { parseRateLimitHeaders, type RateBudget } from "./rateBudget.js";
import type {
  FlagsResponse,
  LeaderboardResponse,
  MapResponse,
  PlayerColors,
} from "./types.js";
import { mapColorForPlayer } from "./playerColors.js";
import { formatCacheAge } from "./cacheAge.js";

export { formatCacheAge } from "./cacheAge.js";

function isApiErrorPayload(payload: unknown): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    !Array.isArray(payload) &&
    typeof (payload as { error?: unknown }).error === "string"
  );
}

function assertUsableLeaderboard(data: unknown): asserts data is LeaderboardResponse {
  if (isApiErrorPayload(data)) {
    throw new Error("leaderboard cache miss: API error payload");
  }
  if (
    typeof data !== "object" ||
    data === null ||
    !Array.isArray((data as LeaderboardResponse).entries)
  ) {
    throw new Error("leaderboard cache miss: payload lacks entries");
  }
}

function assertUsableFlags(data: unknown): asserts data is FlagsResponse {
  if (isApiErrorPayload(data)) {
    throw new Error("flags cache miss: API error payload");
  }
  if (
    typeof data !== "object" ||
    data === null ||
    !Array.isArray((data as FlagsResponse).flags)
  ) {
    throw new Error("flags cache miss: payload lacks flags");
  }
}

const GAME_API_BASE = `${GATEWAY_BASE_URL}/api/v1`;

let rateBudget: RateBudget | null = null;

export interface CachedReadMeta {
  fetchedAt: string | null;
  source: "postgres" | "live";
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

async function fetchGameJson<T>(path: string): Promise<T> {
  const url = `${GAME_API_BASE}${path}`;
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
    const message = error instanceof Error ? error.message : "request failed";
    logApiCall({
      method: "GET",
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
      method: "GET",
      path: `/api/v1${path} (game API)`,
      status: response.status,
      ok: false,
      body,
      error: detail,
    });
    throw new Error(detail);
  }

  logApiCall({
    method: "GET",
    path: `/api/v1${path} (game API)`,
    status: response.status,
    ok: true,
    body,
  });
  return body as T;
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

export function touchUiClaimActivity(): void {
  void fetch(`${GATEWAY_BASE_URL}/_gateway/ui-claim-active`, {
    method: "POST",
    headers: { "X-Source": "ui" },
  });
}

export function enqueueUiClaims(tiles: { x: number; y: number }[]): void {
  if (tiles.length === 0) {
    return;
  }

  void fetch(`${GATEWAY_BASE_URL}/_gateway/ui-claim-queue`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Source": "ui",
    },
    body: JSON.stringify({ tiles }),
  })
    .then(async (response) => {
      if (response.ok) {
        return;
      }
      let body: unknown = null;
      try {
        const text = await response.text();
        if (text) {
          body = JSON.parse(text) as unknown;
        }
      } catch {
        // ignore parse errors on error bodies
      }
      const detail =
        typeof body === "object" && body !== null && "error" in body
          ? String((body as { error: string }).error)
          : response.statusText;
      logApiCall({
        method: "POST",
        path: "/_gateway/ui-claim-queue",
        status: response.status,
        ok: false,
        body,
        error: detail,
      });
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : "request failed";
      logApiCall({
        method: "POST",
        path: "/_gateway/ui-claim-queue",
        status: 0,
        ok: false,
        body: null,
        error: message,
      });
    });
}

export function fetchMap(): Promise<{ data: MapResponse; meta: CachedReadMeta }> {
  return readCachedState<MapResponse>("map");
}

export function fetchMapLive(): Promise<MapResponse> {
  return fetchGameJson<MapResponse>(`/map?game_id=${encodeURIComponent(GAME_ID)}`);
}

/** Prefer postgres cache; fall back to a live GET when cache is missing or empty. */
export async function fetchMapResolved(): Promise<{
  data: MapResponse;
  meta: CachedReadMeta;
}> {
  try {
    const cached = await fetchMap();
    if (cached.data.tiles.length > 0) {
      return cached;
    }
  } catch {
    // cache miss or gateway error — try live
  }

  const data = await fetchMapLive();
  return {
    data,
    meta: { fetchedAt: new Date().toISOString(), source: "live" },
  };
}

export function fetchLeaderboard(): Promise<{
  data: LeaderboardResponse;
  meta: CachedReadMeta;
}> {
  return readCachedState<LeaderboardResponse>("leaderboard").then((result) => {
    assertUsableLeaderboard(result.data);
    return result;
  });
}

export function fetchFlags(): Promise<{ data: FlagsResponse; meta: CachedReadMeta }> {
  return readCachedState<FlagsResponse>("flags").then((result) => {
    assertUsableFlags(result.data);
    return result;
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
    for (const key of ["display_name", "owned", "name", "player_id"]) {
      const value = ownership[key];
      if (typeof value === "string" && value !== "" && value !== "neutral") {
        return value;
      }
    }
  }
  return null;
}

/** Match tile owner to the current player (display name or configured player id). */
export function isSelfOwner(
  owner: string | null,
  selfName: string | null,
  playerId: string,
): boolean {
  if (!owner) {
    return false;
  }
  if (selfName !== null && owner === selfName) {
    return true;
  }
  return playerId !== "" && owner === playerId;
}

export function isSelfTile(
  ownership: string | Record<string, unknown>,
  selfName: string | null,
  playerId: string,
): boolean {
  return isSelfOwner(ownershipName(ownership), selfName, playerId);
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
