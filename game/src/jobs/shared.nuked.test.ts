import { describe, expect, it } from "vitest";
import {
  blockedClaimCells,
  buildOwnershipMap,
  isNukedCell,
  isNukedOwnership,
  isNukedTile,
  type MapResponse,
} from "./shared.js";

describe("isNukedOwnership", () => {
  it("is true for string ownership nuked", () => {
    expect(isNukedOwnership("nuked")).toBe(true);
  });

  it("is false for other string ownership", () => {
    expect(isNukedOwnership("neutral")).toBe(false);
    expect(isNukedOwnership("Me")).toBe(false);
    expect(isNukedOwnership("Nuked")).toBe(false);
  });

  it("is true for object owned/name nuked", () => {
    expect(isNukedOwnership({ owned: "nuked" })).toBe(true);
    expect(isNukedOwnership({ name: "nuked" })).toBe(true);
  });

  it("is false for nullish or unrelated objects", () => {
    expect(isNukedOwnership(null)).toBe(false);
    expect(isNukedOwnership(undefined)).toBe(false);
    expect(isNukedOwnership({ owned: "Me" })).toBe(false);
  });
});

describe("isNukedCell", () => {
  it("returns true when key is in the nuked set", () => {
    const nuked = new Set(["0,0", "2,2"]);
    expect(isNukedCell(nuked, 0, 0)).toBe(true);
    expect(isNukedCell(nuked, 1, 0)).toBe(false);
  });
});

describe("isNukedTile", () => {
  const map: MapResponse = {
    bounds: { min_x: 0, min_y: 0, max_x: 2, max_y: 2 },
    tiles: [
      { x: 0, y: 0, ownership: "nuked" },
      { x: 1, y: 0, ownership: { owned: "Me" } },
    ],
  };

  it("returns true when tile exists and is nuked", () => {
    expect(isNukedTile(map, 0, 0)).toBe(true);
  });

  it("returns false for non-nuked or missing tiles", () => {
    expect(isNukedTile(map, 1, 0)).toBe(false);
    expect(isNukedTile(map, 9, 9)).toBe(false);
  });

  it("uses optional nuked set for O(1) lookup", () => {
    const nuked = new Set(["0,0"]);
    expect(isNukedTile(map, 0, 0, nuked)).toBe(true);
    expect(isNukedTile(map, 1, 0, nuked)).toBe(false);
  });
});

describe("buildOwnershipMap", () => {
  it("returns a nuked set for permanently unclaimable tiles", () => {
    const map: MapResponse = {
      bounds: { min_x: 0, min_y: 0, max_x: 1, max_y: 0 },
      tiles: [
        { x: 0, y: 0, ownership: { owned: "Me" } },
        { x: 1, y: 0, ownership: "nuked" },
      ],
    };
    const { owned, occupied, nuked } = buildOwnershipMap(map.tiles, "Me");

    expect(owned).toEqual(new Set(["0,0"]));
    expect(occupied.get("1,0")).toBe("nuked");
    expect(nuked).toEqual(new Set(["1,0"]));
  });
});

describe("blockedClaimCells", () => {
  it("includes nuked cells from the nuked set", () => {
    const owned = new Set(["0,0"]);
    const nuked = new Set(["1,0"]);

    const blocked = blockedClaimCells(owned, undefined, nuked);

    expect(blocked.has("0,0")).toBe(true);
    expect(blocked.has("1,0")).toBe(true);
    expect(blocked.has("2,0")).toBe(false);
  });

  it("merges pending and nuked with owned", () => {
    const owned = new Set<string>();
    const pending = new Set(["3,3"]);
    const nuked = new Set(["4,4"]);

    const blocked = blockedClaimCells(owned, pending, nuked);

    expect(blocked).toEqual(new Set(["3,3", "4,4"]));
  });

  it("detects nuked via buildOwnershipMap nuked set", () => {
    const map: MapResponse = {
      bounds: { min_x: 0, min_y: 0, max_x: 1, max_y: 0 },
      tiles: [
        { x: 0, y: 0, ownership: { owned: "Me" } },
        { x: 1, y: 0, ownership: "nuked" },
      ],
    };
    const { owned, nuked } = buildOwnershipMap(map.tiles, "Me");
    const blocked = blockedClaimCells(owned, undefined, nuked);

    expect(blocked.has("1,0")).toBe(true);
  });

  it("blocks nuked keys instantly without scanning a huge occupied map", () => {
    const owned = new Set<string>();
    const nuked = new Set(["100,200", "300,400"]);
    const hugeOccupied = new Map<string, string | null>();
    for (let i = 0; i < 5000; i++) {
      hugeOccupied.set(`${i},0`, i % 2 === 0 ? "nuked" : "Enemy");
    }

    const start = performance.now();
    const blocked = blockedClaimCells(owned, undefined, nuked);
    const elapsed = performance.now() - start;

    expect(blocked.has("100,200")).toBe(true);
    expect(blocked.has("300,400")).toBe(true);
    expect(elapsed).toBeLessThan(5);
    expect(hugeOccupied.size).toBe(5000);
  });
});
