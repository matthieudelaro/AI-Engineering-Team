import type { Point } from "./claimStrategy.js";
import { lassoEdgeCells } from "./lassoGeometry.js";
import { pickBridgeStepToward, type MapResponse } from "./shared.js";

/** Large-area ring, not the tiny 5×5 brush — big lassos fill fast. */
export const EXPANSION_LASSO_MIN_HALF_EXTENT = 8;
export const EXPANSION_LASSO_MAX_HALF_EXTENT = 20;

/** Give up on a lasso plan after this many stuck (no-progress) ticks. */
const STAGNANT_LIMIT = 8;

/** A plan smaller than this is not worth pursuing — replan instead. */
const MIN_PLAN_CELLS = 8;

/** How many random F/D/size combinations to try before failing to plan. */
const PLAN_ATTEMPTS = 6;

/** How many owned cells to sample when hunting for the frontier on big maps. */
const FRONTIER_SAMPLE = 64;

const CARDINALS: Point[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

function key(x: number, y: number): string {
  return `${x},${y}`;
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function inBounds(x: number, y: number, bounds: MapResponse["bounds"]): boolean {
  return (
    x >= bounds.min_x &&
    x <= bounds.max_x &&
    y >= bounds.min_y &&
    y <= bounds.max_y
  );
}

/**
 * Sticky planner that grows territory by claiming hollow lasso perimeters just
 * outside our frontier. The game fills the enclosed interior, so a single ring
 * captures far more area than one adjacent tile per claim.
 *
 * A module-level singleton is exported for the live claim path; construct your
 * own instance (or call `resetExpansionLassoPlanner`) in tests.
 */
export class ExpansionLassoPlanner {
  /** Remaining perimeter cells we still want to claim. */
  plan: Point[] = [];
  /** Consecutive ticks where the plan made no progress. */
  stagnant = 0;

  reset(): void {
    this.plan = [];
    this.stagnant = 0;
  }

  next(
    map: MapResponse,
    selfName: string | null,
    owned: Set<string>,
    blocked: Set<string>,
    occupied: Map<string, string | null>,
    bounds: MapResponse["bounds"],
  ): Point | null {
    this.prune(owned, blocked);

    const fromPlan = this.tryAdjacentOrBridge(map, selfName, owned, blocked, occupied);
    if (fromPlan) {
      return fromPlan;
    }
    // Plan still has cells but we could not make progress this tick — wait for
    // in-flight claims to open adjacency rather than thrash a fresh plan.
    if (this.plan.length > 0) {
      return null;
    }

    if (!this.planNewLasso(owned, bounds)) {
      return null;
    }
    this.prune(owned, blocked);
    return this.tryAdjacentOrBridge(map, selfName, owned, blocked, occupied);
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
  ): Point | null {
    if (this.plan.length === 0) {
      return null;
    }

    const adjacent = this.pickAdjacent(owned, blocked, occupied);
    if (adjacent) {
      this.stagnant = 0;
      return adjacent;
    }

    // pickBridgeStepToward treats its `pending` arg as extra blocked cells and
    // unions it with `owned`, so passing `blocked` (owned ∪ pending) is safe.
    const bridge = pickBridgeStepToward(map, selfName, this.plan, owned, blocked);
    if (bridge && this.isClaimable(bridge, owned, blocked, map.bounds)) {
      this.stagnant = 0;
      return bridge;
    }

    this.stagnant += 1;
    if (this.stagnant > STAGNANT_LIMIT) {
      this.plan = [];
      this.stagnant = 0;
    }
    return null;
  }

  /** First plan cell orthogonally adjacent to owned; prefer empty over enemy. */
  private pickAdjacent(
    owned: Set<string>,
    blocked: Set<string>,
    occupied: Map<string, string | null>,
  ): Point | null {
    let enemy: Point | null = null;
    for (const p of this.plan) {
      const k = key(p.x, p.y);
      if (blocked.has(k)) {
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

  private hasOwnedNeighbor(p: Point, owned: Set<string>): boolean {
    for (const d of CARDINALS) {
      if (owned.has(key(p.x + d.x, p.y + d.y))) {
        return true;
      }
    }
    return false;
  }

  private isClaimable(
    p: Point,
    owned: Set<string>,
    blocked: Set<string>,
    bounds: MapResponse["bounds"],
  ): boolean {
    const k = key(p.x, p.y);
    return !owned.has(k) && !blocked.has(k) && inBounds(p.x, p.y, bounds);
  }

  private planNewLasso(
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
      const halfExtent = randomInt(
        EXPANSION_LASSO_MIN_HALF_EXTENT,
        EXPANSION_LASSO_MAX_HALF_EXTENT,
      );
      // Near edge lands at F + D (first expansion layer just outside frontier).
      const center = {
        x: f.x + d.x * (halfExtent + 1),
        y: f.y + d.y * (halfExtent + 1),
      };
      const ring = lassoEdgeCells(center.x, center.y, halfExtent).filter(
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

  /** Owned cells that border at least one in-bounds non-owned cell. */
  private frontierOwnedCells(
    owned: Set<string>,
    bounds: MapResponse["bounds"],
  ): Point[] {
    const ownedList = [...owned];
    const sampleSize = Math.min(FRONTIER_SAMPLE, ownedList.length);
    const seen = new Set<string>();
    const frontier: Point[] = [];

    for (let i = 0; i < sampleSize; i++) {
      const k =
        ownedList.length <= FRONTIER_SAMPLE
          ? ownedList[i]!
          : ownedList[Math.floor(Math.random() * ownedList.length)]!;
      if (seen.has(k)) {
        continue;
      }
      seen.add(k);
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
}

let singleton = new ExpansionLassoPlanner();

/** Shared planner used by the live auto-claim path. */
export function expansionLassoPlanner(): ExpansionLassoPlanner {
  return singleton;
}

/** Reset the shared planner between test cases (or new games). */
export function resetExpansionLassoPlanner(): void {
  singleton = new ExpansionLassoPlanner();
}
