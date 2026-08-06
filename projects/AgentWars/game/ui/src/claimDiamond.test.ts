import { describe, expect, it } from "vitest";
import {
  BRUSH_RADIUS_A,
  BRUSH_RADIUS_D,
  BRUSH_RADIUS_S,
  BRUSH_RADIUS_SHIFT,
  BRUSH_RADIUS_Z,
  brushRadiusFromModifiers,
  diamondCells,
  LASSO_HALF_EXTENT,
  LASSO_SQUARE_SIZE,
  lassoEdgeCells,
  lineCells,
  SHIFT_CLAIM_DIAMOND_RADIUS,
  type BrushModifiers,
} from "./claimDiamond.js";

function mods(partial: Partial<BrushModifiers> = {}): BrushModifiers {
  return {
    shift: false,
    a: false,
    s: false,
    d: false,
    f: false,
    z: false,
    ...partial,
  };
}

describe("diamondCells", () => {
  it("returns a single cell for radius 0", () => {
    expect(diamondCells(4, 7, 0)).toEqual([{ x: 4, y: 7 }]);
  });

  it("returns ~20 tiles for the default shift-claim radius", () => {
    const cells = diamondCells(0, 0);
    expect(cells).toHaveLength(1 + 2 * SHIFT_CLAIM_DIAMOND_RADIUS * (SHIFT_CLAIM_DIAMOND_RADIUS + 1));
    expect(cells.length).toBeGreaterThanOrEqual(20);
    expect(cells.length).toBeLessThanOrEqual(26);
  });

  it("forms a symmetric diamond around the center", () => {
    const cells = diamondCells(10, 20, 2);
    expect(cells).toContainEqual({ x: 10, y: 20 });
    expect(cells).toContainEqual({ x: 12, y: 20 });
    expect(cells).toContainEqual({ x: 8, y: 20 });
    expect(cells).toContainEqual({ x: 10, y: 18 });
    expect(cells).toContainEqual({ x: 10, y: 22 });
    expect(cells).not.toContainEqual({ x: 13, y: 20 });
  });

  it("orders cells center-out by Manhattan distance", () => {
    const cells = diamondCells(0, 0, 2);
    expect(cells[0]).toEqual({ x: 0, y: 0 });
    const distances = cells.map((c) => Math.abs(c.x) + Math.abs(c.y));
    for (let i = 1; i < distances.length; i++) {
      expect(distances[i]!).toBeGreaterThanOrEqual(distances[i - 1]!);
    }
  });
});

describe("lassoEdgeCells", () => {
  it("returns 16 edge tiles for the default 5×5 lasso", () => {
    expect(LASSO_SQUARE_SIZE).toBe(5);
    expect(LASSO_HALF_EXTENT).toBe(2);
    const cells = lassoEdgeCells(0, 0);
    expect(cells).toHaveLength(4 * (LASSO_SQUARE_SIZE - 1));
    expect(cells).toHaveLength(16);
  });

  it("includes corners and excludes the interior", () => {
    const cells = lassoEdgeCells(0, 0);
    expect(cells).toContainEqual({ x: -2, y: -2 });
    expect(cells).toContainEqual({ x: 2, y: -2 });
    expect(cells).toContainEqual({ x: 2, y: 2 });
    expect(cells).toContainEqual({ x: -2, y: 2 });
    expect(cells).not.toContainEqual({ x: 0, y: 0 });
    expect(cells).not.toContainEqual({ x: 1, y: 0 });
    expect(cells).not.toContainEqual({ x: 0, y: 1 });
  });

  it("stays within the 5×5 bounds and has no duplicates", () => {
    const cells = lassoEdgeCells(10, 20);
    const keys = new Set(cells.map((c) => `${c.x},${c.y}`));
    expect(keys.size).toBe(cells.length);
    for (const cell of cells) {
      expect(cell.x).toBeGreaterThanOrEqual(10 - LASSO_HALF_EXTENT);
      expect(cell.x).toBeLessThanOrEqual(10 + LASSO_HALF_EXTENT);
      expect(cell.y).toBeGreaterThanOrEqual(20 - LASSO_HALF_EXTENT);
      expect(cell.y).toBeLessThanOrEqual(20 + LASSO_HALF_EXTENT);
      const onEdge =
        cell.x === 10 - LASSO_HALF_EXTENT ||
        cell.x === 10 + LASSO_HALF_EXTENT ||
        cell.y === 20 - LASSO_HALF_EXTENT ||
        cell.y === 20 + LASSO_HALF_EXTENT;
      expect(onEdge).toBe(true);
    }
  });

  it("walks clockwise from top-left", () => {
    const cells = lassoEdgeCells(0, 0);
    expect(cells[0]).toEqual({ x: -2, y: -2 });
    expect(cells[1]).toEqual({ x: -1, y: -2 });
    expect(cells[4]).toEqual({ x: 2, y: -2 });
    expect(cells[5]).toEqual({ x: 2, y: -1 });
  });
});

describe("brushRadiusFromModifiers", () => {
  it("returns 0 with no modifiers", () => {
    expect(brushRadiusFromModifiers(mods())).toBe(0);
  });

  it("doubles radius for Shift → A → S → D", () => {
    expect(BRUSH_RADIUS_A).toBe(BRUSH_RADIUS_SHIFT * 2);
    expect(BRUSH_RADIUS_S).toBe(BRUSH_RADIUS_A * 2);
    expect(BRUSH_RADIUS_D).toBe(BRUSH_RADIUS_S * 2);
    expect(brushRadiusFromModifiers(mods({ shift: true }))).toBe(BRUSH_RADIUS_SHIFT);
    expect(brushRadiusFromModifiers(mods({ a: true }))).toBe(BRUSH_RADIUS_A);
    expect(brushRadiusFromModifiers(mods({ s: true }))).toBe(BRUSH_RADIUS_S);
    expect(brushRadiusFromModifiers(mods({ d: true }))).toBe(BRUSH_RADIUS_D);
  });

  it("prefers the largest active brush key", () => {
    expect(brushRadiusFromModifiers(mods({ shift: true, a: true }))).toBe(BRUSH_RADIUS_A);
    expect(brushRadiusFromModifiers(mods({ shift: true, a: true, s: true }))).toBe(
      BRUSH_RADIUS_S,
    );
    expect(brushRadiusFromModifiers(mods({ shift: true, a: true, s: true, d: true }))).toBe(
      BRUSH_RADIUS_D,
    );
  });

  it("Z radius is one third of Shift", () => {
    expect(BRUSH_RADIUS_Z).toBe(BRUSH_RADIUS_SHIFT / 3);
    expect(BRUSH_RADIUS_Z).toBe(1);
  });

  it("Z alone yields the small brush", () => {
    expect(brushRadiusFromModifiers(mods({ z: true }))).toBe(BRUSH_RADIUS_Z);
  });

  it("Shift+Z yields Shift (larger brush wins)", () => {
    expect(brushRadiusFromModifiers(mods({ shift: true, z: true }))).toBe(BRUSH_RADIUS_SHIFT);
  });

  it("A/S/D still win over Z", () => {
    expect(brushRadiusFromModifiers(mods({ z: true, a: true }))).toBe(BRUSH_RADIUS_A);
    expect(brushRadiusFromModifiers(mods({ z: true, s: true }))).toBe(BRUSH_RADIUS_S);
    expect(brushRadiusFromModifiers(mods({ z: true, d: true }))).toBe(BRUSH_RADIUS_D);
  });
});

describe("lineCells", () => {
  it("returns a single cell when endpoints match", () => {
    expect(lineCells({ x: 3, y: 5 }, { x: 3, y: 5 })).toEqual([{ x: 3, y: 5 }]);
  });

  it("fills horizontal gaps between sparse pointer samples", () => {
    expect(lineCells({ x: 0, y: 0 }, { x: 4, y: 0 })).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 4, y: 0 },
    ]);
  });

  it("fills diagonal gaps", () => {
    const cells = lineCells({ x: 0, y: 0 }, { x: 3, y: 3 });
    expect(cells[0]).toEqual({ x: 0, y: 0 });
    expect(cells[cells.length - 1]).toEqual({ x: 3, y: 3 });
    expect(cells).toContainEqual({ x: 1, y: 1 });
    expect(cells).toContainEqual({ x: 2, y: 2 });
  });
});
