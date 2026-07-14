import { afterEach, describe, expect, it, vi } from "vitest";
import { pickClaimTarget } from "./claimStrategy.js";
import { frontierCandidates } from "./shared.js";

describe("claimStrategy", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("grows adjacent to a recent claim when grow strategy is chosen", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1);

    const map = {
      bounds: { min_x: 0, min_y: 0, max_x: 5, max_y: 5 },
      tiles: [
        { x: 0, y: 0, ownership: { owned: "Me" } },
        { x: 1, y: 0, ownership: "neutral" },
      ],
    };

    const target = pickClaimTarget(map, { name: "Me", tileCount: 1 }, [{ x: 0, y: 0 }]);
    expect(target).toEqual({ x: 1, y: 0 });
  });

  it("finds frontier candidates from owned set", () => {
    const owned = new Set(["0,0"]);
    const occupied = new Map<string, string | null>([
      ["0,0", "Me"],
      ["1,0", null],
      ["0,1", "Other"],
    ]);
    const bounds = { min_x: 0, min_y: 0, max_x: 3, max_y: 3 };

    const candidates = frontierCandidates(owned, occupied, "Me", bounds);
    expect(candidates).toContainEqual({ x: 1, y: 0 });
    expect(candidates).toContainEqual({ x: 0, y: 1 });
  });

  it("picks a random in-bounds cell when starting on an empty visible map", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);

    const map = {
      bounds: { min_x: -2, min_y: -2, max_x: 2, max_y: 2 },
      tiles: [] as Array<{ x: number; y: number; ownership: string }>,
    };
    const target = pickClaimTarget(map, { name: "Me", tileCount: 0 }, []);
    expect(target).not.toBeNull();
    expect(target!.x).toBeGreaterThanOrEqual(-2);
    expect(target!.x).toBeLessThanOrEqual(2);
  });
});
