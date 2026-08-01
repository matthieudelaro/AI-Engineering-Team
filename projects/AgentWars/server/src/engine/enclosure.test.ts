import { describe, expect, it } from "vitest";
import { tryClaim } from "./claim.js";
import { applyCaptures } from "./enclosure.js";
import { Grid } from "./grid.js";

function fillRect(
  grid: Grid,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  owner: number,
): void {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      grid.setOwner(x, y, owner);
    }
  }
}

describe("enclosure (lasso)", () => {
  it("captures a fully surrounded opponent component", () => {
    const grid = Grid.createInitial(11);
    fillRect(grid, -2, -2, 2, 2, 1);
    fillRect(grid, -1, -1, 0, 0, 2);

    const claim = tryClaim(grid, 1, -1, -1);
    expect(claim.ok).toBe(true);

    const captures = applyCaptures(grid, 1, -1, -1);
    expect(captures.length).toBeGreaterThan(0);
    expect(grid.getOwner(0, 0)).toBe(1);
    expect(grid.getOwner(-1, 0)).toBe(1);
    expect(grid.getOwner(0, -1)).toBe(1);
  });

  it("captures when the victim teleports inside an enemy ring", () => {
    const grid = Grid.createInitial(11);
    // Solid P ring around empty center, then Q claims the center.
    fillRect(grid, -2, -2, 2, 2, 1);
    grid.setOwner(0, 0, 0);
    grid.setOwner(-1, 0, 0);
    grid.setOwner(1, 0, 0);
    grid.setOwner(0, -1, 0);
    grid.setOwner(0, 1, 0);

    // Close the pocket with P, leave a single empty at (0,0).
    fillRect(grid, -1, -1, 1, 1, 1);
    grid.setOwner(0, 0, 0);

    expect(tryClaim(grid, 2, 0, 0).ok).toBe(true);
    const captures = applyCaptures(grid, 2, 0, 0);
    expect(captures.some((c) => c.capturer === 1 && c.victim === 2)).toBe(true);
    expect(grid.getOwner(0, 0)).toBe(1);
  });

  it("does not capture when two victims share the pocket", () => {
    const grid = Grid.createInitial(11);
    fillRect(grid, -2, -2, 2, 2, 1);
    fillRect(grid, -1, -1, 0, 0, 2);
    grid.setOwner(1, 0, 3);

    tryClaim(grid, 1, -1, -1);
    const captures = applyCaptures(grid, 1, -1, -1);
    expect(captures).toHaveLength(0);
    expect(grid.getOwner(-1, -1)).toBe(1);
    expect(grid.getOwner(1, 0)).toBe(3);
    expect(grid.getOwner(0, 0)).toBe(2);
  });

  it("captures Q but leaves nuked interior unchanged", () => {
    const grid = Grid.createInitial(11);
    fillRect(grid, -2, -2, 2, 2, 1);
    grid.setOwner(0, 0, 2);
    grid.setOwner(1, 0, 2);
    grid.setOwner(-1, 0, 2);
    grid.setOwner(0, 1, 2);
    grid.setNuked(0, 1, true);

    tryClaim(grid, 1, 0, 0);
    const captures = applyCaptures(grid, 1, 0, 0);
    expect(captures.length).toBeGreaterThan(0);
    expect(grid.getOwner(-1, 0)).toBe(1);
    expect(grid.getOwner(1, 0)).toBe(1);
    expect(grid.isNuked(0, 1)).toBe(true);
    expect(grid.getOwner(0, 1)).toBe(2);
  });

  it("does not capture with an incomplete ring", () => {
    const grid = Grid.createInitial(11);
    fillRect(grid, -2, -2, 2, 2, 1);
    fillRect(grid, -1, -1, 0, 0, 2);
    grid.setOwner(1, -1, 3);

    tryClaim(grid, 1, -1, -1);
    const captures = applyCaptures(grid, 1, -1, -1);
    expect(captures).toHaveLength(0);
    expect(grid.getOwner(0, 0)).toBe(2);
    expect(grid.getOwner(1, -1)).toBe(3);
  });

  it("does not capture when the boundary has empty gaps", () => {
    const grid = Grid.createInitial(11);
    grid.setOwner(0, 0, 2);
    grid.setOwner(1, 0, 2);
    grid.setOwner(0, 1, 2);
    grid.setOwner(-1, 0, 1);

    const captures = applyCaptures(grid, 1, -1, 0);
    expect(captures).toHaveLength(0);
    expect(grid.getOwner(0, 0)).toBe(2);
    expect(grid.getOwner(1, 0)).toBe(2);
  });
});
