import {
  blockedClaimCells,
  frontierCandidates,
  type MapResponse,
} from "../../jobs/shared.js";
import { LassoBandPlanner } from "./lassoBand.js";
import { MapBelief } from "./mapBelief.js";
import type { Point } from "./types.js";

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/**
 * Random in-bounds cell that is not owned, not nuked, not blocked.
 * Prefers cells adjacent to owned when available.
 */
export function pickRandomFallback(
  map: MapResponse,
  selfName: string | null,
  owned: Set<string>,
  blocked: Set<string>,
  occupied: Map<string, string | null>,
): Point | null {
  const bounds = map.bounds;
  const frontier = frontierCandidates(owned, occupied, selfName, bounds).filter(
    (p) => !blocked.has(cellKey(p.x, p.y)),
  );
  if (frontier.length > 0) {
    return frontier[randomInt(0, frontier.length - 1)]!;
  }

  for (let attempt = 0; attempt < 32; attempt++) {
    const x = randomInt(bounds.min_x, bounds.max_x);
    const y = randomInt(bounds.min_y, bounds.max_y);
    const k = cellKey(x, y);
    if (owned.has(k) || blocked.has(k)) {
      continue;
    }
    const owner = occupied.get(k);
    if (owner === selfName) {
      continue;
    }
    return { x, y };
  }
  return null;
}

export interface ClaimPickInput {
  map: MapResponse;
  belief: MapBelief;
  selfName: string | null;
  owned: Set<string>;
  occupied: Map<string, string | null>;
  nuked: Set<string>;
  pending: Set<string>;
  lasso: LassoBandPlanner;
  scout: boolean;
  nowMs: number;
}

export interface ClaimPickResult {
  target: Point;
  reason: string;
}

/**
 * Next place-tile target: scout probe, lasso band, hole-fill, or random fallback.
 */
export function pickCartographerClaim(
  input: ClaimPickInput,
): ClaimPickResult | null {
  const blocked = blockedClaimCells(input.owned, input.pending, input.nuked);

  if (input.scout) {
    const probe = input.belief.pickScoutTarget(input.nowMs);
    if (probe && !blocked.has(cellKey(probe.x, probe.y))) {
      return { target: probe, reason: "scout" };
    }
  }

  const lassoTarget = input.lasso.next(
    input.map,
    input.selfName,
    input.owned,
    blocked,
    input.occupied,
    input.map.bounds,
    input.nuked,
  );
  if (lassoTarget) {
    return { target: lassoTarget, reason: "lasso" };
  }

  const fallback = pickRandomFallback(
    input.map,
    input.selfName,
    input.owned,
    blocked,
    input.occupied,
  );
  if (fallback) {
    return { target: fallback, reason: "fallback" };
  }

  return null;
}

/** Dry-run planning step for policy test mode (no network). */
export function planOneStep(
  map: MapResponse,
  selfName: string | null,
  nowMs: number,
): { scout: Point | null; claim: ClaimPickResult | null } {
  const belief = MapBelief.fromMap(map, selfName, nowMs);
  const { owned, occupied, nuked } = belief.deriveOwnership();
  const lasso = new LassoBandPlanner();
  const scout = belief.pickScoutTarget(nowMs);
  const claim = pickCartographerClaim({
    map,
    belief,
    selfName,
    owned,
    occupied,
    nuked,
    pending: new Set(),
    lasso,
    scout: false,
    nowMs,
  });
  return { scout, claim };
}
