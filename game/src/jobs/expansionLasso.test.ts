import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ExpansionLassoPlanner,
  EXPANSION_LASSO_MAX_HALF_EXTENT,
  EXPANSION_LASSO_MIN_HALF_EXTENT,
} from "./expansionLasso.js";
import { lassoEdgeCells } from "./lassoGeometry.js";
import type { MapResponse } from "./shared.js";

function mapWith(bounds: MapResponse["bounds"]): MapResponse {
  return { bounds, tiles: [] };
}

describe("lassoEdgeCells", () => {
  it("returns a hollow ring with no interior cell", () => {
    const cells = lassoEdgeCells(0, 0, 2);
    // 5×5 square perimeter = 8 * halfExtent = 16 edge cells.
    expect(cells).toHaveLength(16);
    // Center (and any interior) must be omitted so the game can fill it.
    expect(cells).not.toContainEqual({ x: 0, y: 0 });
    expect(cells).not.toContainEqual({ x: 1, y: 1 });
    // All cells sit on the bounding square edge.
    for (const c of cells) {
      const onEdge = Math.abs(c.x) === 2 || Math.abs(c.y) === 2;
      expect(onEdge).toBe(true);
    }
  });

  it("scales the perimeter with the half-extent", () => {
    expect(lassoEdgeCells(0, 0, 8)).toHaveLength(8 * 8);
    // No duplicate cells.
    const cells = lassoEdgeCells(3, 4, 5);
    const unique = new Set(cells.map((c) => `${c.x},${c.y}`));
    expect(unique.size).toBe(cells.length);
  });
});

describe("ExpansionLassoPlanner", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("plans a large hollow ring whose near edge is adjacent to owned land", () => {
    // Deterministic: smallest frontier index, first cardinal (+x), min half-extent.
    vi.spyOn(Math, "random").mockReturnValue(0);

    const bounds = { min_x: -50, min_y: -50, max_x: 50, max_y: 50 };
    const owned = new Set(["0,0"]);
    const blocked = new Set(["0,0"]);
    const occupied = new Map<string, string | null>([["0,0", "Me"]]);

    const planner = new ExpansionLassoPlanner();
    const target = planner.next(
      mapWith(bounds),
      "Me",
      owned,
      blocked,
      occupied,
      bounds,
    );

    // Near edge sits at F + D = (1, 0), the first expansion layer next to owned.
    expect(target).toEqual({ x: 1, y: 0 });
    // The ring is large, not the tiny 5×5 brush.
    expect(planner.plan.length).toBeGreaterThan(8);
  });

  it("prefers an adjacent plan cell over a far one", () => {
    const bounds = { min_x: -10, min_y: -10, max_x: 10, max_y: 10 };
    const owned = new Set(["0,0"]);
    const blocked = new Set(["0,0"]);
    const occupied = new Map<string, string | null>([
      ["0,0", "Me"],
      ["1,0", null],
      ["5,0", null],
    ]);

    const planner = new ExpansionLassoPlanner();
    planner.plan = [
      { x: 5, y: 0 },
      { x: 1, y: 0 },
    ];

    const target = planner.next(
      mapWith(bounds),
      "Me",
      owned,
      blocked,
      occupied,
      bounds,
    );
    expect(target).toEqual({ x: 1, y: 0 });
  });

  it("bridges one step toward a far-only plan", () => {
    const bounds = { min_x: -10, min_y: -10, max_x: 10, max_y: 10 };
    const owned = new Set(["0,0"]);
    const blocked = new Set(["0,0"]);
    const occupied = new Map<string, string | null>([["0,0", "Me"]]);

    const planner = new ExpansionLassoPlanner();
    planner.plan = [{ x: 5, y: 0 }];

    const target = planner.next(
      mapWith(bounds),
      "Me",
      owned,
      blocked,
      occupied,
      bounds,
    );
    // One orthogonal step from owned (0,0) toward (5,0).
    expect(target).toEqual({ x: 1, y: 0 });
  });

  it("skips blocked/pending plan cells", () => {
    const bounds = { min_x: -10, min_y: -10, max_x: 10, max_y: 10 };
    const owned = new Set(["0,0"]);
    // (1,0) reserved by an in-flight worker.
    const blocked = new Set(["0,0", "1,0"]);
    const occupied = new Map<string, string | null>([
      ["0,0", "Me"],
      ["1,0", null],
      ["0,1", null],
    ]);

    const planner = new ExpansionLassoPlanner();
    planner.plan = [
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ];

    const target = planner.next(
      mapWith(bounds),
      "Me",
      owned,
      blocked,
      occupied,
      bounds,
    );
    expect(target).toEqual({ x: 0, y: 1 });
    // The blocked cell is pruned from the plan.
    expect(planner.plan).not.toContainEqual({ x: 1, y: 0 });
  });

  it("returns null when there is no owned land to expand from", () => {
    const bounds = { min_x: -10, min_y: -10, max_x: 10, max_y: 10 };
    const planner = new ExpansionLassoPlanner();
    const target = planner.next(
      mapWith(bounds),
      "Me",
      new Set<string>(),
      new Set<string>(),
      new Map<string, string | null>(),
      bounds,
    );
    expect(target).toBeNull();
  });

  it("keeps the expansion half-extent in the large-area range", () => {
    expect(EXPANSION_LASSO_MIN_HALF_EXTENT).toBeGreaterThanOrEqual(8);
    expect(EXPANSION_LASSO_MAX_HALF_EXTENT).toBeLessThanOrEqual(20);
    expect(EXPANSION_LASSO_MAX_HALF_EXTENT).toBeGreaterThan(
      EXPANSION_LASSO_MIN_HALF_EXTENT,
    );
  });
});
