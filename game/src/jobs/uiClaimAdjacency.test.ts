import { describe, expect, it } from "vitest";
import {
  findNextAdjacentUiClaimIndex,
  isOrthogonallyAdjacentToSelf,
  markTileOwned,
  pickBridgeStepToward,
  type MapResponse,
} from "./shared.js";

function mapWithOwned(owned: Array<{ x: number; y: number }>): MapResponse {
  return {
    bounds: { min_x: -10, max_x: 10, min_y: -10, max_y: 10 },
    tiles: owned.map((p) => ({
      x: p.x,
      y: p.y,
      ownership: { owned: "Me" },
    })),
  };
}

describe("adjacency helpers for UI claim drain", () => {
  it("marks a tile owned on the local map snapshot", () => {
    const map = mapWithOwned([{ x: 0, y: 0 }]);
    markTileOwned(map, "Me", 1, 0);
    expect(isOrthogonallyAdjacentToSelf(map, "Me", 2, 0)).toBe(true);
  });

  it("picks the earliest FIFO adjacent tile from the work buffer", () => {
    const map = mapWithOwned([{ x: 0, y: 0 }]);
    const work = [
      { x: 5, y: 5 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ];
    expect(findNextAdjacentUiClaimIndex(work, 0, map, "Me")).toBe(1);
  });

  it("skips adjacent tiles that are already owned or reserved", () => {
    const map = mapWithOwned([{ x: 0, y: 0 }]);
    const work = [
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 5, y: 5 },
    ];
    const owned = new Set(["1,0"]);
    const pending = new Set(["0,1"]);
    expect(
      findNextAdjacentUiClaimIndex(work, 0, map, "Me", owned, pending),
    ).toBeNull();
  });

  it("bridges one step toward a distant queued target", () => {
    const map = mapWithOwned([{ x: 0, y: 0 }]);
    const step = pickBridgeStepToward(map, "Me", [{ x: 3, y: 0 }]);
    expect(step).toEqual({ x: 1, y: 0 });
  });
});
