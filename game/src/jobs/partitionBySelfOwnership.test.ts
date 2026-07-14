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

  it("acks self-owned and foreign tiles; only empty cells stay claimable", () => {
    const { claimable, alreadyOwned } = partitionBySelfOwnership(
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ],
      map,
      "Me",
    );

    expect(alreadyOwned).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]);
    expect(claimable).toEqual([{ x: 2, y: 2 }]);
  });

  it("treats unknown self as owning nothing but still skips foreign tiles", () => {
    const { claimable, alreadyOwned } = partitionBySelfOwnership(
      [
        { x: 0, y: 0 },
        { x: 2, y: 2 },
      ],
      map,
      null,
    );
    expect(alreadyOwned).toEqual([{ x: 0, y: 0 }]);
    expect(claimable).toEqual([{ x: 2, y: 2 }]);
  });
});
