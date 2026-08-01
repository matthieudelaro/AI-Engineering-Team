import { describe, expect, it } from "vitest";
import { FLAG_POT_INTERVAL_MS } from "./constants.js";
import { Grid } from "./grid.js";
import { EXPAND_THRESHOLD } from "./constants.js";
import { GameSession } from "./game.js";

function fillToExpandThreshold(grid: Grid, playerId: number): void {
  const total = grid.width * grid.height;
  const needed = Math.ceil(total * EXPAND_THRESHOLD);
  for (let i = 0; i < needed; i++) {
    const x = grid.minX + (i % grid.width);
    const y = grid.minY + Math.floor(i / grid.width);
    grid.setOwner(x, y, playerId);
  }
}

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
      frozenPot: 10,
      createdAtMs: 0,
      nuked: false,
      ownerId: p1,
      lockedOwnerId: null,
    });

    const snapshot = game.toSnapshot();
    const restored = GameSession.createSeeded("restored");
    restored.seedFromSnapshot(snapshot);
    expect(restored.getMapSpectator().tiles.some((t) => t.ownership)).toBe(true);

    restored.launchNuke(p1, 0, 0);
    expect(restored.getFlags().flags[0]?.nuked).toBe(true);
  });

  it("spawns flags in the new ring when the map expands", () => {
    let now = 1_000;
    const game = GameSession.createSeeded("expand-flags", () => now, () => 0.42);
    const p1 = game.registerPlayer("a", "Alpha", "#f00")!;
    fillToExpandThreshold(game.grid, p1);
    let claimX = 0;
    let claimY = 0;
    game.grid.forEachCell((x, y, owner) => {
      if (owner === 0 && claimX === 0 && claimY === 0) {
        claimX = x;
        claimY = y;
      }
    });
    const placed = game.placeTile(p1, claimX, claimY);
    expect(placed.accepted).toBe(true);
    expect(game.grid.width).toBe(26);
    expect(game.flags.length).toBe(1);
    expect(game.getFlags().flags[0]?.pot).toBe(0);
  });

  it("grows flag pots over time and freezes on nuke", () => {
    let now = 0;
    const game = GameSession.createSeeded("pot-growth", () => now);
    const p1 = game.registerPlayer("a", "Alpha", "#f00")!;
    game.placeTile(p1, 0, 0);
    game.flags.push({
      id: "2,2",
      x: 2,
      y: 2,
      frozenPot: 0,
      createdAtMs: 0,
      nuked: false,
      ownerId: p1,
      lockedOwnerId: null,
    });
    game.grid.setOwner(2, 2, p1);

    now = FLAG_POT_INTERVAL_MS * 3;
    expect(game.getFlags().flags[0]?.pot).toBe(3);

    const nuke = game.launchNuke(p1, 0, 0);
    expect(nuke.accepted).toBe(true);
    now += FLAG_POT_INTERVAL_MS * 10;
    const nukedFlag = game.getFlags().flags.find((f) => f.flag_id === "2,2");
    expect(nukedFlag?.nuked).toBe(true);
    expect(nukedFlag?.pot).toBe(3);
  });

  it("allows nuke on unowned tile with distance-based radius", () => {
    const game = GameSession.createSeeded("nuke-far");
    const p1 = game.registerPlayer("a", "Alpha", "#f00")!;
    game.placeTile(p1, 0, 0);
    game.grid.resizeTo(26);
    const far = game.launchNuke(p1, 10, 0);
    expect(far.accepted).toBe(true);
    expect(far.radius).toBe(3);
    expect(far.cost).toBe(49);
    expect(far.cost).toBeLessThan(81);
  });

  it("rejects launchNuke when player owns no tiles", () => {
    const game = GameSession.createSeeded("nuke-no-land");
    const p1 = game.registerPlayer("a", "Alpha", "#f00")!;
    const result = game.launchNuke(p1, 0, 0);
    expect(result.accepted).toBe(false);
    expect(result.rejection_reason).toBe("INVALID_TARGET");
  });

  it("rejects launchNuke out of bounds", () => {
    const game = GameSession.createSeeded("nuke-oob");
    const p1 = game.registerPlayer("a", "Alpha", "#f00")!;
    game.placeTile(p1, 0, 0);
    const result = game.launchNuke(p1, 99, 0);
    expect(result.accepted).toBe(false);
    expect(result.rejection_reason).toBe("OUT_OF_BOUNDS");
  });

  it("rejects launchNuke during cooldown with retry_after", () => {
    let now = 0;
    const game = GameSession.createSeeded("nuke-cd", () => now);
    const p1 = game.registerPlayer("a", "Alpha", "#f00")!;
    game.placeTile(p1, 0, 0);
    game.placeTile(p1, 5, 0);
    expect(game.launchNuke(p1, 0, 0).accepted).toBe(true);
    now = 5_000;
    const blocked = game.launchNuke(p1, 5, 0);
    expect(blocked.accepted).toBe(false);
    expect(blocked.rejection_reason).toBe("COOLDOWN");
    expect(blocked.retry_after).toBe(25);
  });

  it("scores leaderboard from territory, flag pots, and nuke spend", () => {
    let now = FLAG_POT_INTERVAL_MS * 4;
    const game = GameSession.createSeeded("score", () => now);
    const p1 = game.registerPlayer("a", "Alpha", "#f00")!;
    game.placeTile(p1, 0, 0);
    game.flags.push({
      id: "1,0",
      x: 1,
      y: 0,
      frozenPot: 0,
      createdAtMs: 0,
      nuked: false,
      ownerId: p1,
      lockedOwnerId: null,
    });
    game.grid.setOwner(1, 0, p1);

    const beforeNuke = game.getLeaderboard().entries[0]!;
    expect(beforeNuke.score_streams?.flags).toBe(4);
    expect(beforeNuke.score_streams?.territory).toBe(2);

    game.launchNuke(p1, 0, 0);
    const afterNuke = game.getLeaderboard().entries[0]!;
    expect(afterNuke.score_streams?.nuke_cost).toBeLessThan(0);
    expect(afterNuke.score).toBe(
      (afterNuke.score_streams?.territory ?? 0) +
        (afterNuke.score_streams?.flags ?? 0) +
        (afterNuke.score_streams?.nuke_cost ?? 0),
    );
  });

  it("keeps flag score locked after nuke while flags_held drops to 0", () => {
    let now = FLAG_POT_INTERVAL_MS * 5;
    const game = GameSession.createSeeded("nuke-lock", () => now);
    const p1 = game.registerPlayer("a", "Alpha", "#f00")!;
    game.placeTile(p1, 0, 0);
    game.flags.push({
      id: "0,0",
      x: 0,
      y: 0,
      frozenPot: 0,
      createdAtMs: 0,
      nuked: false,
      ownerId: p1,
      lockedOwnerId: null,
    });

    const live = game.getLeaderboard().entries[0]!;
    expect(live.flags_held).toBe(1);
    expect(live.score_streams?.flags).toBe(5);

    game.launchNuke(p1, 0, 0);
    const afterNuke = game.getLeaderboard().entries[0]!;
    expect(afterNuke.flags_held).toBe(0);
    expect(afterNuke.score_streams?.flags).toBe(5);

    now += FLAG_POT_INTERVAL_MS * 10;
    const later = game.getLeaderboard().entries[0]!;
    expect(later.score_streams?.flags).toBe(5);
  });
});
