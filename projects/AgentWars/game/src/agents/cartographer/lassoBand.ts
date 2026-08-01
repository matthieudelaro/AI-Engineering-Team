import type { Point } from "../../jobs/claimStrategy.js";
import {
  lassoEdgeCells,
  DEFAULT_LASSO_HALF_EXTENT,
} from "../../jobs/lassoGeometry.js";
import { pickBridgeStepToward, type MapResponse } from "../../jobs/shared.js";

/** Band width — each sub-contour is a 5×5 hollow lasso (halfExtent=2). */
export const BAND_LASSO_HALF_EXTENT = DEFAULT_LASSO_HALF_EXTENT;

/** How many 5×5 rings to tile along each axis when building a band. */
export const BAND_TILE_COUNT = 2;

const CARDINALS: Point[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

function key(x: number, y: number): string {
  return `${x},${y}`;
}

function inBounds(x: number, y: number, bounds: MapResponse["bounds"]): boolean {
  return (
    x >= bounds.min_x &&
    x <= bounds.max_x &&
    y >= bounds.min_y &&
    y <= bounds.max_y
  );
}

/** Treat map edge and nuked cells as lasso walls. */
export function isWallCell(
  x: number,
  y: number,
  bounds: MapResponse["bounds"],
  nuked: Set<string>,
): boolean {
  if (!inBounds(x, y, bounds)) {
    return true;
  }
  return nuked.has(key(x, y));
}

/**
 * Build a band contour by tiling adjacent 5×5 hollow lassos centered on a
 * frontier anchor. Returns de-duplicated edge cells (width-5 band effect).
 */
export function buildBandRing(
  anchorX: number,
  anchorY: number,
  tileCount = BAND_TILE_COUNT,
): Point[] {
  const seen = new Set<string>();
  const cells: Point[] = [];
  const step = BAND_LASSO_HALF_EXTENT * 2 + 1;

  for (let ti = 0; ti < tileCount; ti++) {
    for (let tj = 0; tj < tileCount; tj++) {
      const cx = anchorX + ti * step;
      const cy = anchorY + tj * step;
      for (const p of lassoEdgeCells(cx, cy, BAND_LASSO_HALF_EXTENT)) {
        const k = key(p.x, p.y);
        if (!seen.has(k)) {
          seen.add(k);
          cells.push(p);
        }
      }
    }
  }
  return cells;
}

/**
 * Flood-fill interior of a ring contour; return in-bounds empty / enemy cells
 * that are not nuked (holes to fill before closing the lasso).
 */
export function detectInteriorHoles(
  contour: Point[],
  owned: Set<string>,
  occupied: Map<string, string | null>,
  bounds: MapResponse["bounds"],
  nuked: Set<string>,
): Point[] {
  if (contour.length === 0) {
    return [];
  }
  const contourSet = new Set(contour.map((p) => key(p.x, p.y)));
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of contour) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }

  const holes: Point[] = [];
  for (let y = minY + 1; y < maxY; y++) {
    for (let x = minX + 1; x < maxX; x++) {
      if (contourSet.has(key(x, y))) {
        continue;
      }
      if (!inBounds(x, y, bounds) || nuked.has(key(x, y))) {
        continue;
      }
      if (owned.has(key(x, y))) {
        continue;
      }
      const owner = occupied.get(key(x, y));
      if (owner === null || owner === undefined || owner === "neutral") {
        holes.push({ x, y });
      } else if (owner !== null) {
        // Mixed owner inside — also a hole to clean when closing.
        holes.push({ x, y });
      }
    }
  }
  return holes;
}

const STAGNANT_LIMIT = 8;
const MIN_PLAN_CELLS = 12;
const PLAN_ATTEMPTS = 6;

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/**
 * Band-of-5 lasso expansion: recursive nested 5×5 rings forming wide contours.
 * Map edges and nuked cells count as valid walls. Hole-fill while closing rings.
 */
export class LassoBandPlanner {
  plan: Point[] = [];
  holeTargets: Point[] = [];
  stagnant = 0;

  reset(): void {
    this.plan = [];
    this.holeTargets = [];
    this.stagnant = 0;
  }

  next(
    map: MapResponse,
    selfName: string | null,
    owned: Set<string>,
    blocked: Set<string>,
    occupied: Map<string, string | null>,
    bounds: MapResponse["bounds"],
    nuked: Set<string>,
  ): Point | null {
    this.prune(owned, blocked);

    const hole = this.nextHoleFill(owned, blocked, occupied, bounds, nuked);
    if (hole) {
      this.stagnant = 0;
      return hole;
    }

    const fromPlan = this.tryAdjacentOrBridge(
      map,
      selfName,
      owned,
      blocked,
      occupied,
      bounds,
      nuked,
    );
    if (fromPlan) {
      return fromPlan;
    }

    if (this.plan.length > 0) {
      return null;
    }

    if (!this.planNewBand(owned, bounds)) {
      return null;
    }
    this.prune(owned, blocked);
    this.holeTargets = detectInteriorHoles(
      this.plan,
      owned,
      occupied,
      bounds,
      nuked,
    );
    return this.tryAdjacentOrBridge(
      map,
      selfName,
      owned,
      blocked,
      occupied,
      bounds,
      nuked,
    );
  }

  nextHoleFill(
    owned: Set<string>,
    blocked: Set<string>,
    occupied: Map<string, string | null>,
    bounds: MapResponse["bounds"],
    nuked: Set<string>,
  ): Point | null {
    this.holeTargets = this.holeTargets.filter((p) => {
      const k = key(p.x, p.y);
      return !owned.has(k) && !blocked.has(k) && !nuked.has(k);
    });
    if (this.holeTargets.length === 0 && this.plan.length > 0) {
      this.holeTargets = detectInteriorHoles(
        this.plan,
        owned,
        occupied,
        bounds,
        nuked,
      ).filter((p) => !blocked.has(key(p.x, p.y)));
    }
    return this.holeTargets[0] ?? null;
  }

  pickPerimeterCell(
    owned: Set<string>,
    blocked: Set<string>,
    occupied: Map<string, string | null>,
    bounds: MapResponse["bounds"],
    nuked: Set<string>,
  ): Point | null {
    let enemy: Point | null = null;
    for (const p of this.plan) {
      const k = key(p.x, p.y);
      if (blocked.has(k) || nuked.has(k)) {
        continue;
      }
      if (isWallCell(p.x, p.y, bounds, nuked)) {
        continue;
      }
      if (!this.hasOwnedNeighbor(p, owned)) {
        continue;
      }
      const owner = occupied.get(k);
      if (!owner || owner === "neutral") {
        return p;
      }
      if (enemy === null) {
        enemy = p;
      }
    }
    return enemy;
  }

  private prune(owned: Set<string>, blocked: Set<string>): void {
    this.plan = this.plan.filter((p) => {
      const k = key(p.x, p.y);
      return !owned.has(k) && !blocked.has(k);
    });
  }

  private tryAdjacentOrBridge(
    map: MapResponse,
    selfName: string | null,
    owned: Set<string>,
    blocked: Set<string>,
    occupied: Map<string, string | null>,
    bounds: MapResponse["bounds"],
    nuked: Set<string>,
  ): Point | null {
    if (this.plan.length === 0) {
      return null;
    }

    const adjacent = this.pickPerimeterCell(
      owned,
      blocked,
      occupied,
      bounds,
      nuked,
    );
    if (adjacent) {
      this.stagnant = 0;
      return adjacent;
    }

    const bridge = pickBridgeStepToward(map, selfName, this.plan, owned, blocked);
    if (
      bridge &&
      !owned.has(key(bridge.x, bridge.y)) &&
      !blocked.has(key(bridge.x, bridge.y))
    ) {
      this.stagnant = 0;
      return bridge;
    }

    this.stagnant += 1;
    if (this.stagnant > STAGNANT_LIMIT) {
      this.plan = [];
      this.holeTargets = [];
      this.stagnant = 0;
    }
    return null;
  }

  private hasOwnedNeighbor(p: Point, owned: Set<string>): boolean {
    for (const d of CARDINALS) {
      if (owned.has(key(p.x + d.x, p.y + d.y))) {
        return true;
      }
    }
    return false;
  }

  private frontierOwnedCells(
    owned: Set<string>,
    bounds: MapResponse["bounds"],
  ): Point[] {
    const frontier: Point[] = [];
    for (const k of owned) {
      const [xs, ys] = k.split(",");
      const x = Number(xs);
      const y = Number(ys);
      for (const d of CARDINALS) {
        const nx = x + d.x;
        const ny = y + d.y;
        if (inBounds(nx, ny, bounds) && !owned.has(key(nx, ny))) {
          frontier.push({ x, y });
          break;
        }
      }
    }
    return frontier;
  }

  private planNewBand(
    owned: Set<string>,
    bounds: MapResponse["bounds"],
  ): boolean {
    const frontier = this.frontierOwnedCells(owned, bounds);
    if (frontier.length === 0) {
      return false;
    }

    for (let attempt = 0; attempt < PLAN_ATTEMPTS; attempt++) {
      const f = frontier[randomInt(0, frontier.length - 1)]!;
      const d = CARDINALS[randomInt(0, CARDINALS.length - 1)]!;
      const anchor = {
        x: f.x + d.x * (BAND_LASSO_HALF_EXTENT + 1),
        y: f.y + d.y * (BAND_LASSO_HALF_EXTENT + 1),
      };
      const ring = buildBandRing(anchor.x, anchor.y).filter(
        (p) => inBounds(p.x, p.y, bounds) && !owned.has(key(p.x, p.y)),
      );
      if (ring.length >= MIN_PLAN_CELLS) {
        this.plan = ring;
        this.stagnant = 0;
        return true;
      }
    }
    return false;
  }
}

let singleton = new LassoBandPlanner();

export function lassoBandPlanner(): LassoBandPlanner {
  return singleton;
}

export function resetLassoBandPlanner(): void {
  singleton = new LassoBandPlanner();
}
