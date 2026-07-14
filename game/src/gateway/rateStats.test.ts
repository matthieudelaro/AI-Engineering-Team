import { describe, expect, it } from "vitest";
import {
  endpointKey,
  endpointLabel,
  formatSourceBreakdown,
  mergePinnedEndpoints,
  PINNED_ENDPOINT_KEYS,
} from "./rateStats.js";

describe("rateStats", () => {
  it("maps known API paths to limit keys", () => {
    expect(endpointKey("GET", "/api/v1/map")).toBe("get_map");
    expect(endpointKey("GET", "/api/v1/flags")).toBe("get_flags");
    expect(endpointKey("POST", "/api/v1/place-tile")).toBe("place_tile");
    expect(endpointKey("GET", "/api/v1/players/foo/stats")).toBe("get_stats");
  });

  it("labels endpoints for display", () => {
    expect(endpointLabel("get_map")).toBe("GET map");
    expect(endpointLabel("place_tile")).toBe("POST place-tile (claim)");
    expect(endpointLabel("get_flags")).toBe("GET flags (spawn intel)");
  });

  it("formats source breakdown for place-tile", () => {
    expect(formatSourceBreakdown({ ui: 3, job: 7 })).toBe(
      " · spawn/claim jobs:7 ui:3",
    );
    expect(formatSourceBreakdown({})).toBe("");
  });
});

describe("mergePinnedEndpoints", () => {
  it("always includes claim and flag endpoints at 0 rps", () => {
    const merged = mergePinnedEndpoints(
      [
        {
          key: "get_leaderboard",
          method: "GET",
          path: "/api/v1/leaderboard",
          count: 5,
          rps: 0.5,
          sources: { poller: 5 },
        },
      ],
      { place_tile: 20, get_flags: 20, get_map: 30, get_leaderboard: 20 },
    );

    expect(merged.map((e) => e.key).slice(0, PINNED_ENDPOINT_KEYS.length)).toEqual([
      ...PINNED_ENDPOINT_KEYS,
    ]);
    expect(merged.find((e) => e.key === "place_tile")?.rps).toBe(0);
    expect(merged.find((e) => e.key === "get_flags")?.rps).toBe(0);
  });
});
