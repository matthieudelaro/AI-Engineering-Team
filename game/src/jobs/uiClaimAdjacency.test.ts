import { describe, expect, it } from "vitest";
import {
  excludeOutOfBoundsCell,
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

  it("does not change bounds when claiming in the interior", () => {
    const bounds = { min_x: 0, min_y: 0, max_x: 10, max_y: 10 };
    const map: MapResponse = {
      bounds: { ...bounds },
      tiles: [{ x: 5, y: 5, ownership: "neutral" }],
    };
    markTileOwned(map, "Me", 5, 5);
    expect(map.bounds).toEqual(bounds);
  });

  it("tightens max edge when API reports out-of-bounds on that edge", () => {
    const map: MapResponse = {
      bounds: { min_x: 0, min_y: 0, max_x: 5, max_y: 5 },
      tiles: [{ x: 0, y: 0, ownership: { owned: "Me" } }],
      fog_padding_tiles: 0,
    };
    excludeOutOfBoundsCell(map, 5, 3);
    expect(map.bounds.max_x).toBe(4);
    expect(map.bounds.max_y).toBe(5);
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

  it("skips nuked adjacent tiles in the work buffer", () => {
    const map: MapResponse = {
      bounds: { min_x: -10, max_x: 10, min_y: -10, max_y: 10 },
      tiles: [
        { x: 0, y: 0, ownership: { owned: "Me" } },
        { x: 1, y: 0, ownership: "nuked" },
        { x: 0, y: 1, ownership: "neutral" },
      ],
    };
    const work = [
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ];
    expect(findNextAdjacentUiClaimIndex(work, 0, map, "Me")).toBe(1);
  });

  it("does not bridge onto a nuked cell", () => {
    const map: MapResponse = {
      bounds: { min_x: -10, max_x: 10, min_y: -10, max_y: 10 },
      tiles: [
        { x: 0, y: 0, ownership: { owned: "Me" } },
        { x: 1, y: 0, ownership: "nuked" },
        { x: 2, y: 0, ownership: "neutral" },
      ],
    };
    const step = pickBridgeStepToward(map, "Me", [{ x: 2, y: 0 }]);
    expect(step).not.toEqual({ x: 1, y: 0 });
    expect(step).not.toBeNull();
  });
});
