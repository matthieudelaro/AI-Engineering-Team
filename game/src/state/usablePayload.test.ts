import { describe, expect, it } from "vitest";
import {
  isApiErrorPayload,
  isUsableGameStatePayload,
  pickUsableCachedRow,
} from "./usablePayload.js";

describe("isApiErrorPayload", () => {
  it("returns true for API error objects", () => {
    expect(
      isApiErrorPayload({
        error: "game_not_found",
        details: "game not found: 8sac",
      }),
    ).toBe(true);
  });

  it("returns false for domain payloads", () => {
    expect(isApiErrorPayload({ entries: [], tick: 0 })).toBe(false);
    expect(isApiErrorPayload(null)).toBe(false);
    expect(isApiErrorPayload("error")).toBe(false);
  });
});

describe("isUsableGameStatePayload", () => {
  it("rejects API error payloads for all endpoint keys", () => {
    const error = { error: "game_not_found", details: "gone" };
    expect(isUsableGameStatePayload("leaderboard", error)).toBe(false);
    expect(isUsableGameStatePayload("map", error)).toBe(false);
    expect(isUsableGameStatePayload("flags", error)).toBe(false);
  });

  it("accepts leaderboard with entries array", () => {
    expect(
      isUsableGameStatePayload("leaderboard", { entries: [], tick: 1 }),
    ).toBe(true);
  });

  it("rejects leaderboard without entries", () => {
    expect(isUsableGameStatePayload("leaderboard", { tick: 1 })).toBe(false);
  });

  it("accepts map with tiles and bounds", () => {
    expect(
      isUsableGameStatePayload("map", {
        tiles: [],
        bounds: { min_x: 0, min_y: 0, max_x: 1, max_y: 1 },
      }),
    ).toBe(true);
  });

  it("rejects map without tiles", () => {
    expect(
      isUsableGameStatePayload("map", {
        bounds: { min_x: 0, min_y: 0, max_x: 1, max_y: 1 },
      }),
    ).toBe(false);
  });

  it("accepts flags with flags array", () => {
    expect(isUsableGameStatePayload("flags", { flags: [] })).toBe(true);
  });

  it("rejects flags without flags array", () => {
    expect(isUsableGameStatePayload("flags", {})).toBe(false);
  });

  it("accepts unknown endpoint keys when not an API error", () => {
    expect(isUsableGameStatePayload("custom", { foo: "bar" })).toBe(true);
  });
});

describe("pickUsableCachedRow", () => {
  const t1 = new Date("2026-01-01T00:00:02Z");
  const t2 = new Date("2026-01-01T00:00:01Z");
  const t3 = new Date("2026-01-01T00:00:00Z");

  it("returns the newest usable row, skipping poisoned latest", () => {
    const rows = [
      {
        payloadJson: { error: "game_not_found" },
        fetchedAt: t1,
        etagOrHash: "bad",
      },
      {
        payloadJson: { entries: [{ display_name: "p", is_self: true, color: "#fff", tile_count: 1 }], tick: 1 },
        fetchedAt: t2,
        etagOrHash: "good",
      },
      {
        payloadJson: { entries: [], tick: 0 },
        fetchedAt: t3,
        etagOrHash: "older",
      },
    ];

    const picked = pickUsableCachedRow("leaderboard", rows);
    expect(picked?.etagOrHash).toBe("good");
    expect(picked?.fetchedAt).toBe(t2);
  });

  it("returns null when no rows are usable", () => {
    const rows = [
      { payloadJson: { error: "gone" }, fetchedAt: t1, etagOrHash: null },
    ];
    expect(pickUsableCachedRow("leaderboard", rows)).toBeNull();
  });
});
