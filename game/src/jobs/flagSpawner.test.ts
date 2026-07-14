import { describe, expect, it } from "vitest";
import {
  adjacentFlagTargets,
  stepTowardFlag,
} from "./flagSpawner.js";

describe("flagSpawner", () => {
  it("prioritizes adjacent flags by pot", () => {
    const owned = new Set(["0,0"]);
    const occupied = new Map<string, string | null>([
      ["0,0", "Me"],
      ["1,0", null],
      ["0,1", null],
    ]);
    const flags = [
      { flag_id: "1,0", x: 1, y: 0, pot: 50, nuked: false },
      { flag_id: "0,1", x: 0, y: 1, pot: 100, nuked: false },
    ];

    const targets = adjacentFlagTargets(flags, owned, occupied, "Me");
    expect(targets).toHaveLength(2);
    expect(targets[0]).toEqual({ x: 0, y: 1, pot: 100 });
  });

  it("steps toward a distant flag through the frontier", () => {
    const owned = new Set(["0,0"]);
    const occupied = new Map<string, string | null>([
      ["0,0", "Me"],
      ["1,0", null],
      ["2,0", null],
    ]);
    const flags = [{ flag_id: "2,0", x: 2, y: 0, pot: 80, nuked: false }];
    const bounds = { min_x: 0, min_y: 0, max_x: 5, max_y: 5 };

    const step = stepTowardFlag(flags, owned, occupied, "Me", bounds);
    expect(step).toEqual({ x: 1, y: 0 });
  });
});
