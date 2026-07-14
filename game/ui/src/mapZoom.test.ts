import { describe, expect, it } from "vitest";
import { computeFitTransform } from "./mapZoom.js";

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
