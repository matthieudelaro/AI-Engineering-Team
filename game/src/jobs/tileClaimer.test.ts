import { afterEach, describe, expect, it, vi } from "vitest";
import {
  findContestedPriorityEnemyTiles,
  pickClaimTarget,
} from "./claimStrategy.js";
import {
  expansionLassoPlanner,
  resetExpansionLassoPlanner,
} from "./expansionLasso.js";
import { frontierCandidates } from "./shared.js";

describe("claimStrategy", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetExpansionLassoPlanner();
  });

  describe("Spammer contest priority", () => {
    it("lists Spammer tiles that touch a third-party player (not self)", () => {
      const occupied = new Map<string, string | null>([
        ["0,0", "Spammer"],
        ["1,0", "Enemy"], // third party — only (0,0) touches this
        ["0,1", "Spammer"], // touches Spammer + Me only
        ["0,2", "Me"],
        ["5,0", "Spammer"], // touches only Spammer neighbor
        ["6,0", "Spammer"],
        ["5,5", "Spammer"], // isolated
      ]);

      const targets = findContestedPriorityEnemyTiles(occupied, "Me");
      expect(targets).toEqual([{ x: 0, y: 0 }]);
    });

    it("claims an adjacent contested Spammer tile before lasso", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.1);

      const map = {
        bounds: { min_x: -5, min_y: -5, max_x: 5, max_y: 5 },
        tiles: [
          { x: 0, y: 0, ownership: { owned: "Me" } },
          { x: 1, y: 0, ownership: { owned: "Spammer" } },
          { x: 2, y: 0, ownership: { owned: "Enemy" } },
          { x: 0, y: 1, ownership: "neutral" },
        ],
      };

      expansionLassoPlanner().plan = [{ x: 0, y: 1 }];

      const target = pickClaimTarget(map, { name: "Me", tileCount: 1 }, [
        { x: 0, y: 0 },
      ]);
      expect(target).toEqual({ x: 1, y: 0 });
    });

    it("bridges toward a contested Spammer tile when not yet adjacent", () => {
      const map = {
        bounds: { min_x: -5, min_y: -5, max_x: 5, max_y: 5 },
        tiles: [
          { x: 0, y: 0, ownership: { owned: "Me" } },
          { x: 1, y: 0, ownership: "neutral" },
          { x: 2, y: 0, ownership: { owned: "Spammer" } },
          { x: 3, y: 0, ownership: { owned: "Enemy" } },
        ],
      };

      expansionLassoPlanner().plan = [{ x: 0, y: 1 }];

      const target = pickClaimTarget(map, { name: "Me", tileCount: 1 }, [
        { x: 0, y: 0 },
      ]);
      expect(target).toEqual({ x: 1, y: 0 });
    });

    it("does not prioritize Spammer tiles that only touch self", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.1);

      const map = {
        bounds: { min_x: -5, min_y: -5, max_x: 5, max_y: 5 },
        tiles: [
          { x: 0, y: 0, ownership: { owned: "Me" } },
          { x: 1, y: 0, ownership: { owned: "Spammer" } },
          { x: 0, y: 1, ownership: "neutral" },
        ],
      };

      expansionLassoPlanner().plan = [{ x: 0, y: 1 }];

      const target = pickClaimTarget(map, { name: "Me", tileCount: 1 }, [
        { x: 0, y: 0 },
      ]);
      expect(target).toEqual({ x: 0, y: 1 });
    });
  });

  it("expands to a valid adjacent cell (lasso, else grow fallback)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1);

    // Bounds too small for a large lasso to fit, so this exercises the grow
    // fallback — the claim must still be a valid cell adjacent to owned land.
    const map = {
      bounds: { min_x: 0, min_y: 0, max_x: 5, max_y: 5 },
      tiles: [
        { x: 0, y: 0, ownership: { owned: "Me" } },
        { x: 1, y: 0, ownership: "neutral" },
      ],
    };

    const target = pickClaimTarget(map, { name: "Me", tileCount: 1 }, [{ x: 0, y: 0 }]);
    expect(target).not.toBeNull();
    const owned = new Set(["0,0"]);
    const isAdjacentToOwned = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ].some((d) => owned.has(`${target!.x + d.x},${target!.y + d.y}`));
    expect(isAdjacentToOwned).toBe(true);
  });

  it("prefers a lasso plan cell over the grow single-neighbor when a plan exists", () => {
    // random=0.1 selects the grow strategy; grow would return (1,0) (first
    // empty neighbor). The lasso planner must win with its own plan cell (0,1).
    vi.spyOn(Math, "random").mockReturnValue(0.1);

    const map = {
      bounds: { min_x: -10, min_y: -10, max_x: 10, max_y: 10 },
      tiles: [
        { x: 0, y: 0, ownership: { owned: "Me" } },
        { x: 1, y: 0, ownership: "neutral" },
        { x: 0, y: 1, ownership: "neutral" },
      ],
    };

    expansionLassoPlanner().plan = [{ x: 0, y: 1 }];

    const target = pickClaimTarget(map, { name: "Me", tileCount: 1 }, [{ x: 0, y: 0 }]);
    expect(target).toEqual({ x: 0, y: 1 });
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

  it("does not pick a nuked adjacent cell when a valid neighbor exists", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1);

    const map = {
      bounds: { min_x: 0, min_y: 0, max_x: 2, max_y: 1 },
      tiles: [
        { x: 0, y: 0, ownership: { owned: "Me" } },
        { x: 1, y: 0, ownership: "nuked" },
        { x: 0, y: 1, ownership: "neutral" },
      ],
    };

    expansionLassoPlanner().plan = [];

    const target = pickClaimTarget(map, { name: "Me", tileCount: 1 }, [{ x: 0, y: 0 }]);
    expect(target).toEqual({ x: 0, y: 1 });
  });

  it("returns null when only adjacent frontier cell is nuked", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1);

    const map = {
      bounds: { min_x: 0, min_y: 0, max_x: 1, max_y: 0 },
      tiles: [
        { x: 0, y: 0, ownership: { owned: "Me" } },
        { x: 1, y: 0, ownership: "nuked" },
      ],
    };

    expansionLassoPlanner().plan = [];

    const target = pickClaimTarget(map, { name: "Me", tileCount: 1 }, [{ x: 0, y: 0 }]);
    expect(target).toBeNull();
  });

  it("does not pick cells already owned or reserved by another worker", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1);

    const map = {
      bounds: { min_x: 0, min_y: 0, max_x: 2, max_y: 0 },
      tiles: [
        { x: 0, y: 0, ownership: { owned: "Me" } },
        { x: 1, y: 0, ownership: { owned: "Me" } },
        { x: 2, y: 0, ownership: "neutral" },
      ],
    };
    const owned = new Set(["0,0", "1,0"]);
    const pending = new Set(["2,0"]);

    const target = pickClaimTarget(
      map,
      { name: "Me", tileCount: 2 },
      [{ x: 1, y: 0 }],
      owned,
      pending,
    );

    expect(target).toBeNull();
  });

  it("uses precomputed occupied without scanning map.tiles", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1);

    const map = {
      bounds: { min_x: 0, min_y: 0, max_x: 2, max_y: 0 },
      tiles: [] as Array<{ x: number; y: number; ownership: unknown }>,
    };
    const owned = new Set(["0,0"]);
    const occupied = new Map<string, string | null>([
      ["0,0", "Me"],
      ["1,0", null],
    ]);
    const nuked = new Set<string>();

    const target = pickClaimTarget(
      map,
      { name: "Me", tileCount: 1 },
      [{ x: 0, y: 0 }],
      owned,
      undefined,
      { occupied, nuked },
    );

    expect(target).toEqual({ x: 1, y: 0 });
  });
});
