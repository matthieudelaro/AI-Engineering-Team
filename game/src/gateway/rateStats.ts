import { desc, sql } from "drizzle-orm";
import type { Database } from "../db/index.js";
import { apiCalls } from "../db/schema.js";

export interface EndpointRateStat {
  key: string;
  method: string;
  path: string;
  count: number;
  rps: number;
  sources: Record<string, number>;
}

export interface RateStatsResponse {
  windowSec: number;
  totalCalls: number;
  endpoints: EndpointRateStat[];
  limits: Record<string, number | null>;
}

const ENDPOINT_LABELS: Record<string, string> = {
  get_map: "GET map",
  get_flags: "GET flags (spawn intel)",
  get_leaderboard: "GET leaderboard",
  get_stats: "GET stats",
  get_method_limits: "GET limits",
  place_tile: "POST place-tile (claim)",
  launch_nuke: "POST nuke",
  request_scan: "POST scan",
  set_emotion: "POST emotion",
};

/** Always shown in the UI rate panel, even at 0 rps in the window. */
export const PINNED_ENDPOINT_KEYS = [
  "place_tile",
  "get_flags",
  "get_map",
  "get_leaderboard",
] as const;

export const PINNED_ENDPOINT_DEFAULTS: Record<
  (typeof PINNED_ENDPOINT_KEYS)[number],
  { method: string; path: string; maxRps: number }
> = {
  place_tile: { method: "POST", path: "/api/v1/place-tile", maxRps: 20 },
  get_flags: { method: "GET", path: "/api/v1/flags", maxRps: 20 },
  get_map: { method: "GET", path: "/api/v1/map", maxRps: 30 },
  get_leaderboard: { method: "GET", path: "/api/v1/leaderboard", maxRps: 20 },
};

const SOURCE_LABELS: Record<string, string> = {
  ui: "ui",
  job: "spawn/claim jobs",
  policy: "policy",
  poller: "poller",
  gateway: "gateway",
};

export function endpointKey(method: string, path: string): string {
  const normalized = path.split("?")[0] ?? path;
  const routes: Array<[string, string, string]> = [
    ["GET", "/api/v1/map", "get_map"],
    ["GET", "/api/v1/flags", "get_flags"],
    ["GET", "/api/v1/leaderboard", "get_leaderboard"],
    ["GET", "/api/v1/method-limits", "get_method_limits"],
    ["POST", "/api/v1/place-tile", "place_tile"],
    ["POST", "/api/v1/launch-nuke", "launch_nuke"],
    ["POST", "/api/v1/request-scan", "request_scan"],
    ["POST", "/api/v1/emotion", "set_emotion"],
  ];

  for (const [m, p, key] of routes) {
    if (method === m && normalized === p) {
      return key;
    }
  }

  const statsMatch = /^\/api\/v1\/players\/[^/]+\/stats$/.exec(normalized);
  if (method === "GET" && statsMatch) {
    return "get_stats";
  }

  return `${method} ${normalized}`;
}

export function endpointLabel(key: string): string {
  return ENDPOINT_LABELS[key] ?? key;
}

export function formatSourceBreakdown(sources: Record<string, number>): string {
  const parts = Object.entries(sources)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([source, count]) => {
      const label = SOURCE_LABELS[source] ?? source;
      return `${label}:${count}`;
    });
  return parts.length > 0 ? ` · ${parts.join(" ")}` : "";
}

export function mergePinnedEndpoints(
  endpoints: EndpointRateStat[],
  limits: Record<string, number | null>,
): EndpointRateStat[] {
  const byKey = new Map(endpoints.map((entry) => [entry.key, entry]));
  const pinned: EndpointRateStat[] = [];
  const pinnedSet = new Set<string>(PINNED_ENDPOINT_KEYS);

  for (const key of PINNED_ENDPOINT_KEYS) {
    const existing = byKey.get(key);
    const defaults = PINNED_ENDPOINT_DEFAULTS[key];
    pinned.push(
      existing ?? {
        key,
        method: defaults.method,
        path: defaults.path,
        count: 0,
        rps: 0,
        sources: {},
      },
    );
    byKey.delete(key);
  }

  const rest = [...byKey.values()].sort((a, b) => b.rps - a.rps);
  return [...pinned, ...rest];
}

interface RawRateRow {
  method: string;
  path: string;
  source: string | null;
  count: number;
}

export async function queryRateStats(
  db: Database,
  windowSec: number,
): Promise<Omit<RateStatsResponse, "limits">> {
  const rows = await db.execute(sql`
    SELECT
      ${apiCalls.method} AS method,
      ${apiCalls.path} AS path,
      coalesce(${apiCalls.source}, 'gateway') AS source,
      count(*)::int AS count
    FROM ${apiCalls}
    WHERE ${apiCalls.ts} >= now() - (${windowSec} || ' seconds')::interval
    GROUP BY ${apiCalls.method}, ${apiCalls.path}, coalesce(${apiCalls.source}, 'gateway')
    ORDER BY count DESC
  `);

  const rawRows = rows.rows as unknown as RawRateRow[];
  const byEndpoint = new Map<
    string,
    { method: string; path: string; count: number; sources: Record<string, number> }
  >();

  for (const row of rawRows) {
    const key = endpointKey(row.method, row.path);
    const existing = byEndpoint.get(key) ?? {
      method: row.method,
      path: row.path,
      count: 0,
      sources: {},
    };
    existing.count += row.count;
    const source = row.source ?? "gateway";
    existing.sources[source] = (existing.sources[source] ?? 0) + row.count;
    byEndpoint.set(key, existing);
  }

  const endpoints: EndpointRateStat[] = [...byEndpoint.entries()]
    .map(([key, value]) => ({
      key,
      method: value.method,
      path: value.path,
      count: value.count,
      rps: value.count / windowSec,
      sources: value.sources,
    }))
    .sort((a, b) => b.rps - a.rps);

  const totalCalls = endpoints.reduce((sum, entry) => sum + entry.count, 0);

  return { windowSec, totalCalls, endpoints };
}

export async function queryMethodLimits(
  db: Database,
): Promise<Record<string, number | null>> {
  const rows = await db
    .select({
      path: apiCalls.path,
      method: apiCalls.method,
      body: apiCalls.responseBody,
    })
    .from(apiCalls)
    .where(sql`${apiCalls.path} = '/api/v1/method-limits' AND ${apiCalls.responseStatus} = 200`)
    .orderBy(desc(apiCalls.ts))
    .limit(1);

  const latest = rows[0];
  if (!latest?.body) {
    return {};
  }

  try {
    const parsed = JSON.parse(latest.body) as Record<
      string,
      { max_per_sec?: number | null } | null
    >;
    const limits: Record<string, number | null> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (key === "fog_of_war_padding_tiles") {
        continue;
      }
      limits[key] = value?.max_per_sec ?? null;
    }
    return limits;
  } catch {
    return {};
  }
}

export async function buildRateStatsResponse(
  db: Database,
  windowSec: number,
): Promise<RateStatsResponse> {
  const [stats, limits] = await Promise.all([
    queryRateStats(db, windowSec),
    queryMethodLimits(db),
  ]);
  const mergedLimits = { ...limits };
  for (const key of PINNED_ENDPOINT_KEYS) {
    if (mergedLimits[key] === undefined) {
      mergedLimits[key] = PINNED_ENDPOINT_DEFAULTS[key].maxRps;
    }
  }
  return {
    ...stats,
    limits: mergedLimits,
    endpoints: mergePinnedEndpoints(stats.endpoints, mergedLimits),
  };
}
