import { describe, expect, it } from "vitest";
import { EMPTY } from "./constants.js";
import { Grid } from "./grid.js";

describe("Grid", () => {
  it("starts 11x11 with world coords -5..5", () => {
    const grid = Grid.createInitial(11);
    expect(grid.width).toBe(11);
    expect(grid.height).toBe(11);
    expect(grid.minX).toBe(-5);
    expect(grid.minY).toBe(-5);
    expect(grid.maxX).toBe(5);
    expect(grid.maxY).toBe(5);
    expect(grid.getOwner(0, 0)).toBe(EMPTY);
  });

  it("indexes world coordinates into flat arrays", () => {
    const grid = Grid.createInitial(11);
    grid.setOwner(3, -2, 2);
    expect(grid.getOwner(3, -2)).toBe(2);
    expect(grid.isNuked(3, -2)).toBe(false);
    grid.setNuked(3, -2, true);
    expect(grid.isNuked(3, -2)).toBe(true);
  });

  it("reports out-of-bounds cells", () => {
    const grid = Grid.createInitial(11);
    expect(grid.inBounds(5, 5)).toBe(true);
    expect(grid.inBounds(6, 0)).toBe(false);
    expect(grid.inBounds(0, -6)).toBe(false);
  });

  it("resizeTo grows centered and preserves cells by world coordinate", () => {
    const grid = Grid.createInitial(11);
    grid.setOwner(0, 0, 1);
    grid.setOwner(5, 5, 2);
    grid.resizeTo(26);
    expect(grid.width).toBe(26);
    expect(grid.height).toBe(26);
    expect(grid.getOwner(0, 0)).toBe(1);
    expect(grid.getOwner(5, 5)).toBe(2);
    expect(grid.inBounds(6, 0)).toBe(true);
  });

  it("counts claimed tiles", () => {
    const grid = Grid.createInitial(11);
    expect(grid.claimedCount()).toBe(0);
    grid.setOwner(0, 0, 1);
    grid.setOwner(1, 0, 2);
    expect(grid.claimedCount()).toBe(2);
  });
});
