import { describe, expect, it } from "vitest";
import { Grid } from "./grid.js";
import {
  computeNukeRadius,
  launchNuke,
  nearestOwnedChebyshevDistance,
} from "./nuke.js";

describe("nuke", () => {
  it("computes radius from distance decay model", () => {
    expect(computeNukeRadius(0)).toBe(4);
    expect(computeNukeRadius(7)).toBe(3);
    expect(computeNukeRadius(27)).toBe(1);
    expect(computeNukeRadius(100)).toBe(1);
  });

  it("nearestOwnedChebyshevDistance is 0 on owned target", () => {
    const grid = Grid.createInitial(11);
    grid.setOwner(0, 0, 1);
    expect(nearestOwnedChebyshevDistance(grid, 1, 0, 0)).toBe(0);
  });

  it("charges only newly nuked cells", () => {
    const grid = Grid.createInitial(11);
    grid.setOwner(0, 0, 1);
    const first = launchNuke(grid, 1, 0, 0, "launch-1");
    expect(first.radius).toBe(4);
    expect(first.cost).toBe(81);

    grid.setOwner(5, 0, 1);
    const second = launchNuke(grid, 1, 5, 0, "launch-2");
    expect(second.cost).toBeLessThan(first.cost);
    expect(second.cost).toBeGreaterThan(0);
  });

  it("uses smaller radius and cost for distant unowned targets", () => {
    const grid = Grid.createInitial(11);
    grid.setOwner(0, 0, 1);
    const owned = launchNuke(grid, 1, 0, 0, "launch-owned");
    expect(owned.radius).toBe(4);
    expect(owned.cost).toBe(81);

    const grid2 = Grid.createInitial(26);
    grid2.setOwner(0, 0, 1);
    const distant = launchNuke(grid2, 1, 10, 0, "launch-far");
    expect(nearestOwnedChebyshevDistance(grid2, 1, 10, 0)).toBe(10);
    expect(distant.radius).toBe(3);
    expect(distant.cost).toBe(49);
    expect(distant.cost).toBeLessThan(owned.cost);
  });

  it("clears ownership on newly nuked cells", () => {
    const grid = Grid.createInitial(11);
    grid.setOwner(0, 0, 1);
    grid.setOwner(1, 0, 2);
    launchNuke(grid, 1, 0, 0, "launch-1");
    expect(grid.isNuked(1, 0)).toBe(true);
    expect(grid.getOwner(1, 0)).toBe(0);
    expect(grid.getOwner(0, 0)).toBe(0);
  });
});
