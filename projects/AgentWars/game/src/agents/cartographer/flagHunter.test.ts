import { describe, expect, it } from "vitest";
import {
  FlagHunter,
  ENEMY_NUKE_WINDOW_MS,
  selectFeintTarget,
  selectStealTarget,
} from "./flagHunter.js";
import type { FlagInfo } from "./types.js";

const self = "Me";

function flag(
  id: string,
  x: number,
  y: number,
  pot: number,
  nuked = false,
): FlagInfo {
  return { flag_id: id, x, y, pot, nuked };
}

describe("FlagHunter", () => {
  it("detects newly nuked enemy flag and opens attack window", () => {
    const hunter = new FlagHunter(self);
    const t0 = 1_000_000;
    hunter.observe(
      [flag("a", 1, 1, 50, false)],
      new Map([["1,1", "Enemy"]]),
      t0,
    );
    const window = hunter.observe(
      [flag("a", 1, 1, 50, true)],
      new Map([["1,1", "Enemy"]]),
      t0 + 1000,
    );
    expect(window).not.toBeNull();
    expect(window?.enemyName).toBe("Enemy");
    expect(window?.expiresAt).toBe(t0 + 1000 + ENEMY_NUKE_WINDOW_MS);
  });

  it("attributes nuker from previous owner when map cell is already nuked", () => {
    const hunter = new FlagHunter(self);
    const t0 = 1_000_000;
    hunter.observe(
      [flag("a", 1, 1, 50, false)],
      new Map([["1,1", "Enemy"]]),
      t0,
    );
    // Real API: after nuke, tile ownership is "nuked", not the prior owner.
    const window = hunter.observe(
      [flag("a", 1, 1, 50, true)],
      new Map([["1,1", "nuked"]]),
      t0 + 1000,
    );
    expect(window).not.toBeNull();
    expect(window?.enemyName).toBe("Enemy");
  });

  it("does not open window when our own flag is nuked", () => {
    const hunter = new FlagHunter(self);
    const t0 = 0;
    hunter.observe([flag("b", 2, 2, 10, false)], new Map([["2,2", self]]), t0);
    const window = hunter.observe(
      [flag("b", 2, 2, 10, true)],
      new Map([["2,2", self]]),
      t0 + 500,
    );
    expect(window).toBeNull();
  });

  it("attack window is active within 30s of enemy nuke", () => {
    const hunter = new FlagHunter(self);
    const t0 = 0;
    hunter.observe([flag("c", 0, 0, 20, false)], new Map([["0,0", "Rival"]]), t0);
    hunter.observe([flag("c", 0, 0, 20, true)], new Map([["0,0", "Rival"]]), t0 + 1);
    expect(hunter.isAttackWindowOpen(t0 + ENEMY_NUKE_WINDOW_MS - 1)).toBe(true);
    expect(hunter.isAttackWindowOpen(t0 + ENEMY_NUKE_WINDOW_MS + 1)).toBe(false);
  });

  it("inferEnemiesWithNuke includes owners of active flags not on cooldown", () => {
    const hunter = new FlagHunter(self);
    const flags = [flag("a", 1, 1, 50, false)];
    const owners = new Map([["1,1", "Enemy"]]);
    hunter.observe(flags, owners, 1000);
    const withNuke = hunter.inferEnemiesWithNuke(flags, owners, 1000);
    expect(withNuke.has("Enemy")).toBe(true);
  });

  it("inferEnemiesWithNuke excludes owner who just nuked for 30s", () => {
    const hunter = new FlagHunter(self);
    const t0 = 0;
    const owners = new Map([["1,1", "Enemy"]]);
    hunter.observe([flag("a", 1, 1, 50, false)], owners, t0);
    hunter.observe([flag("a", 1, 1, 50, true)], owners, t0 + 1);
    const flagsAfter = [flag("a", 1, 1, 50, true), flag("b", 5, 5, 10, false)];
    const ownersAfter = new Map([
      ["1,1", "Enemy"],
      ["5,5", "Enemy"],
    ]);
    const withNuke = hunter.inferEnemiesWithNuke(flagsAfter, ownersAfter, t0 + 2);
    expect(withNuke.has("Enemy")).toBe(false);
  });

  it("planCapture feints when owner in enemiesWithNuke and cheap flag is adjacent", () => {
    const hunter = new FlagHunter(self);
    hunter.observe([flag("w", 0, 0, 1, false)], new Map([["0,0", "BigFish"]]), 0);
    hunter.observe([flag("w", 0, 0, 1, true)], new Map([["0,0", "BigFish"]]), 1);
    const flags = [
      flag("cheap", 5, 5, 5, false),
      flag("juicy", 10, 10, 100, false),
    ];
    const owners = new Map([
      ["5,5", "BigFish"],
      ["10,10", "BigFish"],
    ]);
    // cheap adjacent to 4,5; juicy adjacent to 9,10 — steal targets juicy, feint targets cheap.
    const owned = new Set(["4,5", "9,10"]);
    const plan = hunter.planCapture(
      flags,
      owners,
      owned,
      100,
      new Set(["BigFish"]),
    );
    expect(plan?.reason).toBe("feint");
    expect(plan?.target).toEqual({ x: 5, y: 5 });
  });

  it("planCapture steals directly when owner is on nuke cooldown", () => {
    const hunter = new FlagHunter(self);
    const t0 = 0;
    const flags = [
      flag("cheap", 5, 5, 5, false),
      flag("juicy", 10, 10, 100, false),
    ];
    const owners = new Map([
      ["5,5", "BigFish"],
      ["10,10", "BigFish"],
    ]);
    hunter.observe([flag("cheap", 5, 5, 5, false)], new Map([["5,5", "BigFish"]]), t0);
    hunter.observe([flag("cheap", 5, 5, 5, true)], new Map([["5,5", "BigFish"]]), t0 + 1);
    const owned = new Set(["9,10"]);
    const enemiesWithNuke = hunter.inferEnemiesWithNuke(flags, owners, t0 + 100);
    expect(enemiesWithNuke.has("BigFish")).toBe(false);
    const plan = hunter.planCapture(flags, owners, owned, t0 + 100, enemiesWithNuke);
    expect(plan?.reason).toBe("steal");
    expect(plan?.target).toEqual({ x: 10, y: 10 });
  });

  describe("planNuke", () => {
    it("returns active flag on a tile we own", () => {
      const hunter = new FlagHunter(self);
      const flags = [flag("stolen", 10, 10, 80, false)];
      const owners = new Map([["10,10", self]]);
      const owned = new Set(["10,10"]);
      expect(hunter.planNuke(flags, owners, owned)).toEqual({
        flagId: "stolen",
        x: 10,
        y: 10,
      });
    });

    it("prefers highest pot among owned active flags", () => {
      const hunter = new FlagHunter(self);
      const flags = [
        flag("small", 1, 1, 10, false),
        flag("big", 2, 2, 100, false),
      ];
      const owners = new Map([
        ["1,1", self],
        ["2,2", self],
      ]);
      const owned = new Set(["1,1", "2,2"]);
      expect(hunter.planNuke(flags, owners, owned)?.flagId).toBe("big");
    });

    it("returns null for enemy-owned tiles not in owned set", () => {
      const hunter = new FlagHunter(self);
      const flags = [flag("enemy", 5, 5, 50, false)];
      const owners = new Map([["5,5", "Enemy"]]);
      const owned = new Set<string>();
      expect(hunter.planNuke(flags, owners, owned)).toBeNull();
    });

    it("returns null for nuked flags even when we own the tile", () => {
      const hunter = new FlagHunter(self);
      const flags = [flag("dead", 3, 3, 50, true)];
      const owners = new Map([["3,3", self]]);
      const owned = new Set(["3,3"]);
      expect(hunter.planNuke(flags, owners, owned)).toBeNull();
    });

    it("returns null when flag tile is not owned", () => {
      const hunter = new FlagHunter(self);
      const flags = [flag("far", 8, 8, 20, false)];
      const owners = new Map<string, string | null>();
      const owned = new Set(["1,1"]);
      expect(hunter.planNuke(flags, owners, owned)).toBeNull();
    });
  });
});

describe("selectFeintTarget", () => {
  it("picks a cheaper flag owned by the juicy target owner", () => {
    const flags = [
      flag("cheap", 5, 5, 5, false),
      flag("juicy", 10, 10, 100, false),
    ];
    const owners = new Map([
      ["5,5", "BigFish"],
      ["10,10", "BigFish"],
    ]);
    const owned = new Set(["4,5"]);
    const feint = selectFeintTarget(flags, owners, owned, "BigFish", self);
    expect(feint).toEqual({
      x: 5,
      y: 5,
      flagId: "cheap",
      pot: 5,
      owner: "BigFish",
    });
  });
});

describe("selectStealTarget", () => {
  it("prefers high-value non-nuked enemy flags near our territory", () => {
    const flags = [
      flag("far", 50, 50, 200, false),
      flag("near", 6, 0, 80, false),
    ];
    const owners = new Map([
      ["50,50", "Enemy"],
      ["6,0", "Enemy"],
    ]);
    const owned = new Set(["5,0", "5,1"]);
    const steal = selectStealTarget(flags, owners, owned, self, null);
    expect(steal?.flagId).toBe("near");
  });

  it("skips nuked flags as capture targets", () => {
    const flags = [flag("dead", 1, 1, 999, true)];
    const owners = new Map([["1,1", "Enemy"]]);
    const steal = selectStealTarget(flags, owners, new Set(["0,1"]), self, null);
    expect(steal).toBeNull();
  });
});
