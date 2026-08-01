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
