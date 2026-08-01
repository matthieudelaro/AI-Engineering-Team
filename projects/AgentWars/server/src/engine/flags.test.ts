import { describe, expect, it } from "vitest";
import {
  FLAG_DENSITY_DIVISOR,
  FLAG_POT_INTERVAL_MS,
} from "./constants.js";
import { Grid } from "./grid.js";
import {
  computePot,
  createFlag,
  materializePots,
  spawnFlagsInRing,
  targetFlagCount,
  type FlagState,
} from "./flags.js";

describe("flags", () => {
  it("targetFlagCount matches production density ladder", () => {
    expect(targetFlagCount(11)).toBe(0);
    expect(targetFlagCount(132)).toBe(36);
    expect(targetFlagCount(172)).toBe(62);
    expect(targetFlagCount(224)).toBe(105);
    expect(targetFlagCount(292)).toBe(178);
    expect(FLAG_DENSITY_DIVISOR).toBe(480);
  });

  it("computePot grows +1 every 5 seconds while live", () => {
    const flag = createFlag(3, 4, 0);
    expect(computePot(flag, 0)).toBe(0);
    expect(computePot(flag, FLAG_POT_INTERVAL_MS - 1)).toBe(0);
    expect(computePot(flag, FLAG_POT_INTERVAL_MS)).toBe(1);
    expect(computePot(flag, FLAG_POT_INTERVAL_MS * 3 + 1)).toBe(3);
  });

  it("computePot freezes at nuke time", () => {
    const flag = createFlag(1, 1, 0);
    const atNuke = FLAG_POT_INTERVAL_MS * 4 + 100;
    flag.nuked = true;
    flag.frozenPot = computePot({ ...flag, nuked: false }, atNuke);
    flag.lockedOwnerId = 1;
    expect(computePot(flag, atNuke + FLAG_POT_INTERVAL_MS * 10)).toBe(4);
  });

  it("spawns only in the new ring on expand", () => {
    const grid = Grid.createInitial(11);
    const oldBounds = grid.bounds();
    grid.resizeTo(26);

    const flags = spawnFlagsInRing(
      grid,
      oldBounds,
      [],
      26,
      0,
      () => 0,
    );

    expect(flags.length).toBeGreaterThan(0);
    for (const flag of flags) {
      const inOld =
        flag.x >= oldBounds.min_x &&
        flag.x <= oldBounds.max_x &&
        flag.y >= oldBounds.min_y &&
        flag.y <= oldBounds.max_y;
      expect(inOld).toBe(false);
      expect(flag.id).toBe(`${flag.x},${flag.y}`);
      expect(grid.getOwner(flag.x, flag.y)).toBe(0);
      expect(grid.isNuked(flag.x, flag.y)).toBe(false);
    }
  });

  it("does not spawn on initial 11x11 map", () => {
    const grid = Grid.createInitial(11);
    const flags = spawnFlagsInRing(grid, grid.bounds(), [], 11, 0, () => 0);
    expect(flags).toHaveLength(0);
  });

  it("materializePots updates frozenPot for live flags", () => {
    const flags: FlagState[] = [createFlag(0, 0, 1000)];
    materializePots(flags, 1000 + FLAG_POT_INTERVAL_MS * 2);
    expect(flags[0]!.frozenPot).toBe(2);
    expect(flags[0]!.createdAtMs).toBe(1000 + FLAG_POT_INTERVAL_MS * 2);
  });

  it("materializePots preserves sub-interval remainder across frequent polls", () => {
    const flags: FlagState[] = [createFlag(0, 0, 1000)];

    materializePots(flags, 2000);
    expect(computePot(flags[0]!, 2000)).toBe(0);
    materializePots(flags, 3000);
    expect(computePot(flags[0]!, 3000)).toBe(0);
    materializePots(flags, 4000);
    expect(computePot(flags[0]!, 4000)).toBe(0);

    materializePots(flags, 6000);
    expect(computePot(flags[0]!, 6000)).toBe(1);
    expect(flags[0]!.createdAtMs).toBe(6000);

    materializePots(flags, 7000);
    materializePots(flags, 8000);
    materializePots(flags, 9000);
    materializePots(flags, 10000);
    expect(computePot(flags[0]!, 10000)).toBe(1);

    materializePots(flags, 11000);
    expect(computePot(flags[0]!, 11000)).toBe(2);
  });
});
