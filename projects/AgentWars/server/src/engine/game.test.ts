import { describe, expect, it } from "vitest";
import { GameSession } from "./game.js";

describe("GameSession", () => {
  it("registers up to 8 players", () => {
    const game = GameSession.create("test-game");
    for (let i = 1; i <= 8; i++) {
      expect(game.registerPlayer(`p${i}`, `Player ${i}`, `#${i}`)).toBe(i);
    }
    expect(game.registerPlayer("p9", "Player 9", "#9")).toBeNull();
  });

  it("placeTile emits tile_captured events with display names", () => {
    const game = GameSession.createSeeded("lasso-test");
    const p1 = game.registerPlayer("a", "Alpha", "#f00")!;
    const p2 = game.registerPlayer("b", "Beta", "#0f0")!;

    const first = game.placeTile(p1, 0, 0);
    expect(first.accepted).toBe(true);
    const captured = first.events.find((e) => e.event_type === "tile_captured");
    expect(captured?.detail.player_id).toBe("Alpha");

    game.placeTile(p2, 5, 5);
    game.placeTile(p1, 1, 0);
    game.placeTile(p1, 0, 1);
    game.placeTile(p1, -1, 0);
    game.placeTile(p1, 0, -1);

    const result = game.getLeaderboard();
    expect(result.entries.length).toBe(2);
    expect(result.entries[0]!.tile_count).toBeGreaterThan(1);
    expect(result.tick).toBeGreaterThan(0);
  });

  it("getMapForPlayer uses display-name ownership", () => {
    const game = GameSession.createSeeded("fog-test");
    const p1 = game.registerPlayer("a", "Alpha", "#f00")!;
    game.registerPlayer("b", "Beta", "#0f0")!;
    game.placeTile(p1, 0, 0);
    game.placeTile(2, 5, 5);

    const view = game.getMapForPlayer(p1);
    expect(view.tiles.every((t) => Math.hypot(t.x, t.y) <= 5)).toBe(true);
    const owned = view.tiles.find((t) => t.x === 0 && t.y === 0);
    expect(owned?.ownership).toEqual({ owned: "Alpha" });
    expect(view.fog_padding_tiles).toBe(3);
  });

  it("rejects invalid placeTile with reason", () => {
    const game = GameSession.createSeeded("reject-test");
    const p1 = game.registerPlayer("a", "Alpha", "#f00")!;
    game.placeTile(p1, 0, 0);
    const again = game.placeTile(p1, 0, 0);
    expect(again.accepted).toBe(false);
    expect(again.rejection_reason).toBe("INVALID_TARGET");
  });

  it("round-trips snapshots and marks flags nuked with tiles", () => {
    const game = GameSession.createSeeded("snapshot-test");
    const p1 = game.registerPlayer("p1", "One", "#111")!;
    game.placeTile(p1, 0, 0);
    game.flags.push({
      id: "f1",
      x: 0,
      y: 0,
      pot: 10,
      nuked: false,
      ownerId: p1,
    });

    const snapshot = game.toSnapshot();
    const restored = GameSession.createSeeded("restored");
    restored.seedFromSnapshot(snapshot);
    expect(restored.getMapSpectator().tiles.some((t) => t.ownership)).toBe(true);

    restored.launchNuke(p1, 0, 0);
    expect(restored.getFlags().flags[0]?.nuked).toBe(true);
  });
});
