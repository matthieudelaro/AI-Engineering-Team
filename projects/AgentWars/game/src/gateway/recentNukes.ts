import { and, asc, desc, eq, gt } from "drizzle-orm";
import type { Database } from "../db/index.js";
import { apiCalls } from "../db/schema.js";

export const LAUNCH_NUKE_PATH = "/api/v1/launch-nuke";

export interface RecentNuke {
  id: number;
  ts: string;
  source: string;
  target_x: number;
  target_y: number;
  accepted: boolean;
  cost_charged?: number;
  effective_radius_tiles?: number;
  rejection_reason?: string;
  retry_after?: number;
}

export interface RecentNukesResponse {
  nukes: RecentNuke[];
}

export interface RecentNukesQuery {
  sinceId?: number;
  limit: number;
}

export const DEFAULT_RECENT_NUKES_LIMIT = 10;
export const MAX_RECENT_NUKES_LIMIT = 50;

interface NukeResponseBody {
  accepted?: {
    effect?: {
      cost_charged?: number;
      effective_radius_tiles?: number;
    };
  };
  rejected?: {
    reason?: string;
    retry_after?: number;
  };
}

export interface ApiCallNukeRow {
  id: number;
  ts: Date;
  source: string | null;
  requestBody: string | null;
  responseBody: string | null;
  responseStatus: number | null;
}

export interface NukeResponseOutcome {
  accepted: boolean;
  cost_charged?: number;
  effective_radius_tiles?: number;
  rejection_reason?: string;
  retry_after?: number;
}

export function normalizeRecentNukesQuery(query: {
  since_id?: string | number;
  limit?: string | number;
}): RecentNukesQuery {
  const limitRaw =
    query.limit !== undefined
      ? Number.parseInt(String(query.limit), 10)
      : DEFAULT_RECENT_NUKES_LIMIT;
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(limitRaw, MAX_RECENT_NUKES_LIMIT)
      : DEFAULT_RECENT_NUKES_LIMIT;

  let sinceId: number | undefined;
  if (query.since_id !== undefined) {
    const parsed = Number.parseInt(String(query.since_id), 10);
    if (Number.isFinite(parsed)) {
      sinceId = parsed;
    }
  }

  return sinceId === undefined ? { limit } : { sinceId, limit };
}

export function parseNukeTargetCoords(
  requestBody: string | null | undefined,
): { target_x: number; target_y: number } | null {
  if (!requestBody) {
    return null;
  }
  try {
    const parsed = JSON.parse(requestBody) as Record<string, unknown>;
    const x = parsed.target_x;
    const y = parsed.target_y;
    if (
      typeof x === "number" &&
      Number.isFinite(x) &&
      typeof y === "number" &&
      Number.isFinite(y)
    ) {
      return { target_x: x, target_y: y };
    }
    return null;
  } catch {
    return null;
  }
}

export function parseNukeResponse(
  responseBody: string | null | undefined,
  _responseStatus: number | null | undefined,
): NukeResponseOutcome {
  let body: NukeResponseBody = {};
  if (responseBody) {
    try {
      body = JSON.parse(responseBody) as NukeResponseBody;
    } catch {
      /* invalid JSON */
    }
  }

  if (body.accepted) {
    const effect = body.accepted.effect;
    const outcome: NukeResponseOutcome = { accepted: true };
    if (effect?.cost_charged !== undefined) {
      outcome.cost_charged = effect.cost_charged;
    }
    if (effect?.effective_radius_tiles !== undefined) {
      outcome.effective_radius_tiles = effect.effective_radius_tiles;
    }
    return outcome;
  }

  const outcome: NukeResponseOutcome = { accepted: false };
  const rejected = body.rejected;
  if (rejected?.reason) {
    outcome.rejection_reason = rejected.reason;
  }
  if (rejected?.retry_after !== undefined) {
    outcome.retry_after = rejected.retry_after;
  }
  return outcome;
}

export function mapApiCallToRecentNuke(row: ApiCallNukeRow): RecentNuke | null {
  const coords = parseNukeTargetCoords(row.requestBody);
  if (!coords) {
    return null;
  }

  const outcome = parseNukeResponse(row.responseBody, row.responseStatus);
  const nuke: RecentNuke = {
    id: row.id,
    ts: row.ts.toISOString(),
    source: row.source ?? "gateway",
    target_x: coords.target_x,
    target_y: coords.target_y,
    accepted: outcome.accepted,
  };

  if (outcome.cost_charged !== undefined) {
    nuke.cost_charged = outcome.cost_charged;
  }
  if (outcome.effective_radius_tiles !== undefined) {
    nuke.effective_radius_tiles = outcome.effective_radius_tiles;
  }
  if (outcome.rejection_reason !== undefined) {
    nuke.rejection_reason = outcome.rejection_reason;
  }
  if (outcome.retry_after !== undefined) {
    nuke.retry_after = outcome.retry_after;
  }

  return nuke;
}

const nukeRowSelect = {
  id: apiCalls.id,
  ts: apiCalls.ts,
  source: apiCalls.source,
  requestBody: apiCalls.requestBody,
  responseBody: apiCalls.responseBody,
  responseStatus: apiCalls.responseStatus,
};

export async function queryRecentNukes(
  db: Database,
  options: RecentNukesQuery,
): Promise<RecentNuke[]> {
  const pathFilter = and(
    eq(apiCalls.method, "POST"),
    eq(apiCalls.path, LAUNCH_NUKE_PATH),
  );

  const rows =
    options.sinceId !== undefined
      ? await db
          .select(nukeRowSelect)
          .from(apiCalls)
          .where(and(pathFilter, gt(apiCalls.id, options.sinceId)))
          .orderBy(asc(apiCalls.id))
          .limit(options.limit)
      : await db
          .select(nukeRowSelect)
          .from(apiCalls)
          .where(pathFilter)
          .orderBy(desc(apiCalls.id))
          .limit(options.limit);

  const nukes: RecentNuke[] = [];
  for (const row of rows) {
    const mapped = mapApiCallToRecentNuke(row);
    if (mapped) {
      nukes.push(mapped);
    }
  }
  return nukes;
}

export async function buildRecentNukesResponse(
  db: Database,
  query: { since_id?: string; limit?: string },
): Promise<RecentNukesResponse> {
  const options = normalizeRecentNukesQuery(query);
  const nukes = await queryRecentNukes(db, options);
  return { nukes };
}
