import { describe, expect, it } from "vitest";
import {
  BRUSH_RADIUS_A,
  BRUSH_RADIUS_D,
  BRUSH_RADIUS_S,
  BRUSH_RADIUS_SHIFT,
  brushRadiusFromModifiers,
  diamondCells,
  lineCells,
  SHIFT_CLAIM_DIAMOND_RADIUS,
} from "./claimDiamond.js";

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

describe("brushRadiusFromModifiers", () => {
  it("returns 0 with no modifiers", () => {
    expect(brushRadiusFromModifiers({ shift: false, a: false, s: false, d: false })).toBe(0);
  });

  it("doubles radius for Shift → A → S → D", () => {
    expect(BRUSH_RADIUS_A).toBe(BRUSH_RADIUS_SHIFT * 2);
    expect(BRUSH_RADIUS_S).toBe(BRUSH_RADIUS_A * 2);
    expect(BRUSH_RADIUS_D).toBe(BRUSH_RADIUS_S * 2);
    expect(brushRadiusFromModifiers({ shift: true, a: false, s: false, d: false })).toBe(
      BRUSH_RADIUS_SHIFT,
    );
    expect(brushRadiusFromModifiers({ shift: false, a: true, s: false, d: false })).toBe(
      BRUSH_RADIUS_A,
    );
    expect(brushRadiusFromModifiers({ shift: false, a: false, s: true, d: false })).toBe(
      BRUSH_RADIUS_S,
    );
    expect(brushRadiusFromModifiers({ shift: false, a: false, s: false, d: true })).toBe(
      BRUSH_RADIUS_D,
    );
  });

  it("prefers the largest active brush key", () => {
    expect(brushRadiusFromModifiers({ shift: true, a: true, s: false, d: false })).toBe(
      BRUSH_RADIUS_A,
    );
    expect(brushRadiusFromModifiers({ shift: true, a: true, s: true, d: false })).toBe(
      BRUSH_RADIUS_S,
    );
    expect(brushRadiusFromModifiers({ shift: true, a: true, s: true, d: true })).toBe(
      BRUSH_RADIUS_D,
    );
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
