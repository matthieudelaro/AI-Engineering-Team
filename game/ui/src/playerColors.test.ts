import { describe, expect, it } from "vitest";
import {
  SELF_MAP_COLOR,
  buildPlayerColors,
  mapColorForPlayer,
} from "./playerColors.js";
import type { LeaderboardEntry, PlayerColors } from "./types.js";

function entry(
  partial: Partial<LeaderboardEntry> & Pick<LeaderboardEntry, "display_name">,
): LeaderboardEntry {
  return {
    is_self: false,
    color: "#3366ff",
    tile_count: 10,
    score: 100,
    ...partial,
  };
}

describe("buildPlayerColors", () => {
  it("keeps self on fixed pink", () => {
    const colors = buildPlayerColors([
      entry({ display_name: "me", is_self: true, color: "#00ff00" }),
      entry({ display_name: "other", color: "#3366ff" }),
    ]);
    expect(colors.selfName).toBe("me");
    expect(colors.selfColor).toBe(SELF_MAP_COLOR);
    expect(mapColorForPlayer("me", colors)).toBe(SELF_MAP_COLOR);
  });

  it("assigns collision shades by stable display_name, not tile_count", () => {
    const shared = "#aabbcc";
    const first = buildPlayerColors([
      entry({ display_name: "alice", color: shared, tile_count: 100, score: 999 }),
      entry({ display_name: "bob", color: shared, tile_count: 1, score: 1 }),
    ]);
    const aliceColor = mapColorForPlayer("alice", first);
    const bobColor = mapColorForPlayer("bob", first);
    expect(aliceColor).not.toBe(bobColor);

    const flipped = buildPlayerColors([
      entry({ display_name: "alice", color: shared, tile_count: 1, score: 1 }),
      entry({ display_name: "bob", color: shared, tile_count: 100, score: 999 }),
    ]);
    expect(mapColorForPlayer("alice", flipped)).toBe(aliceColor);
    expect(mapColorForPlayer("bob", flipped)).toBe(bobColor);
  });

  it("preserves sticky colors when API colors swap across rebuilds", () => {
    const first = buildPlayerColors([
      entry({ display_name: "alice", color: "#ff0000", tile_count: 50 }),
      entry({ display_name: "bob", color: "#00ff00", tile_count: 10 }),
    ]);
    const aliceColor = mapColorForPlayer("alice", first);
    const bobColor = mapColorForPlayer("bob", first);
    expect(aliceColor).toBe("#ff0000");
    expect(bobColor).toBe("#00ff00");

    const previous: PlayerColors = {
      selfName: first.selfName,
      selfColor: first.selfColor,
      byName: new Map(first.byName),
    };

    const swapped = buildPlayerColors(
      [
        entry({ display_name: "alice", color: "#00ff00", tile_count: 10 }),
        entry({ display_name: "bob", color: "#ff0000", tile_count: 50 }),
      ],
      previous,
    );
    expect(mapColorForPlayer("alice", swapped)).toBe(aliceColor);
    expect(mapColorForPlayer("bob", swapped)).toBe(bobColor);
  });

  it("gives new players a free API color when sticky colors leave it available", () => {
    const previous: PlayerColors = {
      selfName: null,
      selfColor: SELF_MAP_COLOR,
      byName: new Map([["alice", "#ff0000"]]),
    };
    const colors = buildPlayerColors(
      [
        entry({ display_name: "alice", color: "#00ff00" }),
        entry({ display_name: "carol", color: "#0000ff" }),
      ],
      previous,
    );
    expect(mapColorForPlayer("alice", colors)).toBe("#ff0000");
    expect(mapColorForPlayer("carol", colors)).toBe("#0000ff");
  });
});
