import { describe, expect, it } from "vitest";
import { partitionBySelfOwnership, type MapResponse } from "./shared.js";

describe("partitionBySelfOwnership", () => {
  const map: MapResponse = {
    bounds: { min_x: 0, min_y: 0, max_x: 2, max_y: 2 },
    tiles: [
      { x: 0, y: 0, ownership: { owned: "Me" } },
      { x: 1, y: 1, ownership: { owned: "Other" } },
    ],
  };

  it("acks only self-owned tiles; enemy tiles stay claimable for attacks", () => {
    const { claimable, alreadyOwned } = partitionBySelfOwnership(
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ],
      map,
      "Me",
    );

    expect(alreadyOwned).toEqual([{ x: 0, y: 0 }]);
    expect(claimable).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
  });

  it("treats unknown self as owning nothing", () => {
    const { claimable, alreadyOwned } = partitionBySelfOwnership(
      [
        { x: 0, y: 0 },
        { x: 2, y: 2 },
      ],
      map,
      null,
    );
    expect(alreadyOwned).toEqual([]);
    expect(claimable).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 2 },
    ]);
  });

  it("routes permanently unclaimable nuked tiles to alreadyOwned (ack path)", () => {
    const nukedMap: MapResponse = {
      bounds: { min_x: 0, min_y: 0, max_x: 2, max_y: 2 },
      tiles: [
        { x: 0, y: 0, ownership: { owned: "Me" } },
        { x: 1, y: 0, ownership: "nuked" },
      ],
    };

    const { claimable, alreadyOwned } = partitionBySelfOwnership(
      [
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ],
      nukedMap,
      "Me",
    );

    expect(alreadyOwned).toEqual([{ x: 1, y: 0 }]);
    expect(claimable).toEqual([{ x: 0, y: 1 }]);
  });
});
