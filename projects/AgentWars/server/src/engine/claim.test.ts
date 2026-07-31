import { describe, expect, it } from "vitest";
import { tryClaim } from "./claim.js";
import { Grid } from "./grid.js";

describe("claim", () => {
  it("allows first claim anywhere empty in bounds", () => {
    const grid = Grid.createInitial(11);
    const result = tryClaim(grid, 1, 2, -1);
    expect(result.ok).toBe(true);
    expect(grid.getOwner(2, -1)).toBe(1);
  });

  it("rejects out-of-bounds targets", () => {
    const grid = Grid.createInitial(11);
    const result = tryClaim(grid, 1, 10, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("OUT_OF_BOUNDS");
    }
  });

  it("allows non-adjacent claims after the first tile", () => {
    const grid = Grid.createInitial(11);
    grid.setOwner(0, 0, 1);
    const far = tryClaim(grid, 1, 3, 0);
    expect(far.ok).toBe(true);
    expect(grid.getOwner(3, 0)).toBe(1);
  });

  it("rejects nuked and own tiles", () => {
    const grid = Grid.createInitial(11);
    grid.setOwner(0, 0, 1);
    grid.setOwner(1, 0, 1);
    const own = tryClaim(grid, 1, 0, 0);
    expect(own.ok).toBe(false);

    grid.setOwner(0, 1, 0);
    grid.setNuked(0, 1, true);
    const nuked = tryClaim(grid, 1, 0, 1);
    expect(nuked.ok).toBe(false);
  });

  it("can claim enemy tiles", () => {
    const grid = Grid.createInitial(11);
    grid.setOwner(0, 0, 1);
    grid.setOwner(1, 0, 2);
    const result = tryClaim(grid, 1, 1, 0);
    expect(result.ok).toBe(true);
    expect(grid.getOwner(1, 0)).toBe(1);
  });
});
