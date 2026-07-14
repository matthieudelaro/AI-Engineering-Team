import { describe, expect, it } from "vitest";
import {
  inZone,
  partitionBoardHorizontally,
  validateZones,
} from "./zone.js";

describe("inZone", () => {
  it("returns true for cells inside zone", () => {
    expect(inZone({ x: 5, y: 5 }, { x: 0, y: 0, w: 10, h: 10 })).toBe(true);
  });

  it("returns false for cells outside zone", () => {
    expect(inZone({ x: 15, y: 5 }, { x: 0, y: 0, w: 10, h: 10 })).toBe(false);
  });
});

describe("partitionBoardHorizontally", () => {
  it("creates non-overlapping zones", () => {
    const zones = partitionBoardHorizontally({ width: 100, height: 50 }, 2);
    expect(zones).toHaveLength(2);
    validateZones(zones);
    expect(zones[0]?.w).toBe(50);
    expect(zones[1]?.x).toBe(50);
  });
});
