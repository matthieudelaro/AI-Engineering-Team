import { describe, expect, it } from "vitest";
import { EXPAND_THRESHOLD, SIZE_LADDER } from "./constants.js";
import { Grid } from "./grid.js";
import { nextLadderSize, shouldExpand } from "./expand.js";

describe("expand", () => {
  it("does not expand below 70% claimed", () => {
    const grid = Grid.createInitial(11);
    const total = grid.width * grid.height;
    const below = Math.floor(total * EXPAND_THRESHOLD) - 1;
    for (let i = 0; i < below; i++) {
      const x = grid.minX + (i % grid.width);
      const y = grid.minY + Math.floor(i / grid.width);
      grid.setOwner(x, y, 1);
    }
    expect(shouldExpand(grid)).toBe(false);
  });

  it("expands at 70% claimed to next ladder size", () => {
    const grid = Grid.createInitial(11);
    const total = grid.width * grid.height;
    const needed = Math.ceil(total * EXPAND_THRESHOLD);
    for (let i = 0; i < needed; i++) {
      const x = grid.minX + (i % grid.width);
      const y = grid.minY + Math.floor(i / grid.width);
      grid.setOwner(x, y, 1);
    }
    expect(shouldExpand(grid)).toBe(true);
    expect(nextLadderSize(11)).toBe(26);
    grid.resizeTo(nextLadderSize(11)!);
    expect(grid.width).toBe(26);
  });

  it("caps expansion at 300", () => {
    expect(nextLadderSize(292)).toBe(300);
    expect(nextLadderSize(300)).toBeNull();
    expect(SIZE_LADDER.at(-1)).toBe(300);
  });
});
