import { describe, expect, it } from "vitest";
import { LassoBandPlanner, detectInteriorHoles, buildBandRing } from "./lassoBand.js";
import { lassoEdgeCells } from "../../jobs/lassoGeometry.js";
import type { MapResponse } from "../../jobs/shared.js";

function mapWith(
  bounds: MapResponse["bounds"],
  tiles: MapResponse["tiles"] = [],
): MapResponse {
  return { bounds, tiles };
}

describe("buildBandRing", () => {
  it("composes 5×5 hollow lassos (halfExtent=2) into a band contour", () => {
    const cells = buildBandRing(0, 0, 2);
    // Two adjacent 5×5 rings share edges — union should exceed one ring.
    expect(cells.length).toBeGreaterThan(16);
    const unique = new Set(cells.map((c) => `${c.x},${c.y}`));
    expect(unique.size).toBe(cells.length);
  });

  it("each sub-lasso is a hollow 5×5 ring", () => {
    const single = lassoEdgeCells(0, 0, 2);
    expect(single).toHaveLength(16);
    expect(single).not.toContainEqual({ x: 0, y: 0 });
  });
});

describe("detectInteriorHoles", () => {
  it("finds empty cells inside a partial square ring", () => {
    const bounds = { min_x: -10, min_y: -10, max_x: 10, max_y: 10 };
    const ring = lassoEdgeCells(0, 0, 2);
    const owned = new Set<string>();
    const occupied = new Map<string, string | null>();
    for (const p of ring) {
      occupied.set(`${p.x},${p.y}`, "Me");
    }
    const holes = detectInteriorHoles(ring, owned, occupied, bounds, new Set());
    expect(holes.some((h) => h.x === 0 && h.y === 0)).toBe(true);
  });

  it("treats nuked cells as walls not holes to fill", () => {
    const bounds = { min_x: -5, min_y: -5, max_x: 5, max_y: 5 };
    const ring = lassoEdgeCells(0, 0, 2);
    const owned = new Set<string>();
    const occupied = new Map<string, string | null>();
    const nuked = new Set(["0,0"]);
    for (const p of ring) {
      occupied.set(`${p.x},${p.y}`, "Me");
    }
    occupied.set("0,0", null);
    const holes = detectInteriorHoles(ring, owned, occupied, bounds, nuked);
    expect(holes).not.toContainEqual({ x: 0, y: 0 });
  });
});

describe("LassoBandPlanner", () => {
  const bounds = { min_x: -20, min_y: -20, max_x: 20, max_y: 20 };

  it("prefers perimeter cells adjacent to empty over enemy-only", () => {
    const owned = new Set(["1,0"]);
    const blocked = new Set(["1,0"]);
    const occupied = new Map<string, string | null>([
      ["1,0", "Me"],
      ["2,0", null],
      ["3,0", "Enemy"],
    ]);
    const planner = new LassoBandPlanner();
    planner.plan = [
      { x: 3, y: 0 },
      { x: 2, y: 0 },
    ];
    const next = planner.pickPerimeterCell(owned, blocked, occupied, bounds, new Set());
    expect(next).toEqual({ x: 2, y: 0 });
  });

  it("plans a band from frontier owned cells", () => {
    const owned = new Set(["0,0", "1,0"]);
    const blocked = new Set([...owned]);
    const occupied = new Map<string, string | null>([
      ["0,0", "Me"],
      ["1,0", "Me"],
    ]);
    const planner = new LassoBandPlanner();
    const target = planner.next(
      mapWith(bounds),
      "Me",
      owned,
      blocked,
      occupied,
      bounds,
      new Set(),
    );
    expect(target).not.toBeNull();
    expect(planner.plan.length).toBeGreaterThan(0);
  });

  it("returns hole-fill target when interior has empties", () => {
    const ring = lassoEdgeCells(5, 5, 2);
    const owned = new Set<string>();
    const occupied = new Map<string, string | null>();
    for (const p of ring) {
      owned.add(`${p.x},${p.y}`);
      occupied.set(`${p.x},${p.y}`, "Me");
    }
    const blocked = new Set(owned);
    const planner = new LassoBandPlanner();
    planner.plan = [...ring];
    const hole = planner.nextHoleFill(owned, blocked, occupied, bounds, new Set());
    expect(hole).not.toBeNull();
    expect(hole!.x).toBeGreaterThanOrEqual(4);
    expect(hole!.x).toBeLessThanOrEqual(6);
    expect(hole!.y).toBeGreaterThanOrEqual(4);
    expect(hole!.y).toBeLessThanOrEqual(6);
  });
});
