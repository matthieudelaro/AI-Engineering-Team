import { describe, expect, it } from "vitest";
import {
  activeFlagKeys,
  cellHasActiveFlag,
  mergeFlagCoordsIntoRender,
} from "./flagOverlay.js";
import type { FlagInfo } from "./types.js";

function flag(partial: Partial<FlagInfo> & Pick<FlagInfo, "x" | "y">): FlagInfo {
  return {
    flag_id: `f-${partial.x}-${partial.y}`,
    pot: 1,
    nuked: false,
    ...partial,
  };
}

describe("activeFlagKeys", () => {
  it("includes only non-nuked flags as x,y keys", () => {
    const keys = activeFlagKeys([
      flag({ x: 1, y: 2 }),
      flag({ x: 3, y: 4, nuked: true }),
      flag({ x: -1, y: 0, flag_id: "alive" }),
    ]);
    expect(keys.has("1,2")).toBe(true);
    expect(keys.has("3,4")).toBe(false);
    expect(keys.has("-1,0")).toBe(true);
    expect(keys.size).toBe(2);
  });
});

describe("cellHasActiveFlag", () => {
  it("is true when map tile reports a flag or cache has an active flag", () => {
    const keys = activeFlagKeys([flag({ x: 5, y: 6 })]);
    expect(cellHasActiveFlag(5, 6, false, keys)).toBe(true);
    expect(cellHasActiveFlag(0, 0, true, keys)).toBe(true);
    expect(cellHasActiveFlag(0, 0, false, keys)).toBe(false);
  });
});

describe("mergeFlagCoordsIntoRender", () => {
  it("adds flag-only cells that are missing from existing coords", () => {
    const keys = activeFlagKeys([
      flag({ x: 1, y: 1 }),
      flag({ x: 9, y: 9 }),
      flag({ x: 2, y: 2, nuked: true }),
    ]);
    const merged = mergeFlagCoordsIntoRender(
      [
        { x: 1, y: 1 },
        { x: 3, y: 3 },
      ],
      keys,
    );
    expect(merged).toEqual([
      { x: 1, y: 1 },
      { x: 3, y: 3 },
      { x: 9, y: 9 },
    ]);
  });
});
