import { describe, expect, it } from "vitest";
import {
  computeFitRectTransform,
  computeFitTransform,
  MIN_SCALE_RELATIVE_TO_FIT,
  minScaleFromFit,
} from "./mapZoom.js";
import { claimedContentPixelRect, CELL_SIZE, CELL_GAP } from "./boardCanvas.js";

describe("computeFitTransform", () => {
  it("scales down a large board to fit the viewport", () => {
    const fit = computeFitTransform(800, 600, 4000, 3000, 0);
    expect(fit.scale).toBeCloseTo(0.2);
    expect(fit.translateX).toBeCloseTo(0);
    expect(fit.translateY).toBeCloseTo(0);
  });

  it("centers a smaller board in the viewport", () => {
    const fit = computeFitTransform(800, 600, 200, 100, 0);
    expect(fit.scale).toBeCloseTo(4);
    expect(fit.translateX).toBeCloseTo(0);
    expect(fit.translateY).toBeCloseTo(100);
  });
});

describe("minScaleFromFit", () => {
  it("allows zooming out well past fit-to-view", () => {
    expect(minScaleFromFit(0.2)).toBeCloseTo(0.2 * MIN_SCALE_RELATIVE_TO_FIT);
    expect(minScaleFromFit(0.2)).toBeLessThan(0.2);
  });

  it("never goes below the absolute floor", () => {
    expect(minScaleFromFit(0.001)).toBe(0.01);
  });
});

describe("computeFitRectTransform", () => {
  it("centers a content rect in the viewport", () => {
    const fit = computeFitRectTransform(
      800,
      600,
      { x: 100, y: 50, width: 200, height: 100 },
      0,
    );
    expect(fit.scale).toBeCloseTo(4);
    // center of rect (200, 100) maps to viewport center (400, 300)
    expect(fit.translateX).toBeCloseTo(400 - 200 * 4);
    expect(fit.translateY).toBeCloseTo(300 - 100 * 4);
  });
});

describe("claimedContentPixelRect", () => {
  const bounds = { min_x: 0, min_y: 0, max_x: 100, max_y: 100 };

  it("returns null for an empty cell list", () => {
    expect(claimedContentPixelRect(bounds, [])).toBeNull();
  });

  it("covers claimed cells with padding inside bounds", () => {
    const rect = claimedContentPixelRect(
      bounds,
      [
        { x: 10, y: 10 },
        { x: 12, y: 11 },
      ],
      2,
    );
    expect(rect).not.toBeNull();
    // padded x: 10-2 .. 12+2 → 8..14; y: 10-2 .. 11+2 → 8..13
    const stride = CELL_SIZE + CELL_GAP;
    expect(rect!.x).toBe(8 * stride);
    expect(rect!.y).toBe(8 * stride);
    expect(rect!.width).toBe((14 - 8) * stride + CELL_SIZE);
    expect(rect!.height).toBe((13 - 8) * stride + CELL_SIZE);
  });
});
