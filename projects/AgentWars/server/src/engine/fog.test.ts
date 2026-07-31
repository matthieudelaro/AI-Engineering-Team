import { describe, expect, it } from "vitest";
import { FOG_PADDING } from "./constants.js";
import { getVisibleForPlayer } from "./fog.js";
import { Grid } from "./grid.js";

describe("fog", () => {
  it("reveals owned tiles and Chebyshev padding", () => {
    const grid = Grid.createInitial(11);
    grid.setOwner(0, 0, 1);
    const visible = getVisibleForPlayer(grid, 1);
    expect(visible.tiles.some((t) => t.x === 0 && t.y === 0)).toBe(true);
    expect(
      visible.tiles.some((t) => t.x === FOG_PADDING && t.y === 0),
    ).toBe(true);
    expect(
      visible.tiles.some((t) => t.x === FOG_PADDING + 1 && t.y === 0),
    ).toBe(false);
    expect(visible.bounds.min_x).toBeLessThanOrEqual(0 - FOG_PADDING);
    expect(visible.bounds.max_x).toBeGreaterThanOrEqual(0 + FOG_PADDING);
  });

  it("hides distant tiles from other players", () => {
    const grid = Grid.createInitial(11);
    grid.setOwner(0, 0, 1);
    grid.setOwner(4, 4, 2);
    const p1View = getVisibleForPlayer(grid, 1);
    expect(p1View.tiles.some((t) => t.x === 4 && t.y === 4)).toBe(false);
  });
});
