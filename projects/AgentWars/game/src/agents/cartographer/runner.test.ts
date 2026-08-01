import { describe, expect, it } from "vitest";
import { pickPlaceTileActionForTest } from "./runner.js";
import { FlagHunter } from "./flagHunter.js";
import { LassoBandPlanner } from "./lassoBand.js";
import { MapBelief } from "./mapBelief.js";
import type { FlagInfo } from "./types.js";
import type { MapResponse } from "../../jobs/shared.js";

function flag(id: string, x: number, y: number, pot: number): FlagInfo {
  return { flag_id: id, x, y, pot, nuked: false };
}

describe("pickPlaceTileAction", () => {
  const bounds = { min_x: 0, min_y: 0, max_x: 20, max_y: 20 };
  it("prioritizes flag steal over territory claim during attack window", () => {
    const self = "Me";
    const mapWithFrontier: MapResponse = {
      bounds,
      tiles: [
        { x: 9, y: 10, ownership: { owned: "Me" } },
        { x: 10, y: 10, ownership: { owned: "BigFish" } },
      ],
    };
    const belief = MapBelief.fromMap(mapWithFrontier, self, 0);
    const hunter = new FlagHunter(self);
    hunter.observe([flag("w", 0, 0, 1)], new Map([["0,0", "BigFish"]]), 0);
    hunter.observe(
      [{ flag_id: "w", x: 0, y: 0, pot: 1, nuked: true }],
      new Map([["0,0", "BigFish"]]),
      1,
    );

    const flags = [
      flag("juicy", 10, 10, 100),
      flag("cheap", 5, 5, 5),
    ];
    const occupied = new Map<string, string | null>([
      ["9,10", self],
      ["10,10", "BigFish"],
      ["5,5", "BigFish"],
    ]);
    const owned = new Set(["9,10"]);
    const nuked = new Set<string>();

    const action = pickPlaceTileActionForTest({
      belief,
      lasso: new LassoBandPlanner(),
      flagHunter: hunter,
      flags,
      flagOwners: new Map(),
      map: mapWithFrontier,
      selfName: self,
      owned,
      occupied,
      nuked,
      pending: new Set(),
      tickIndex: 0,
      nowMs: 100,
    });

    expect(action?.kind).toBe("flag_claim");
    expect(action?.reason).toBe("steal");
    expect(action).toMatchObject({ x: 10, y: 10 });
  });
});
