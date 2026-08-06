/** @vitest-environment happy-dom */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  computeCooldownEndsAtFromAccept,
  computeCooldownEndsAtFromRetryAfter,
  fetchRecentNukes,
  formatCooldownLabel,
  formatNukeToastMessage,
  initNukeToast,
  NUKE_COOLDOWN_MS,
  type RecentNukesResponse,
} from "./nukeToast.js";

describe("formatNukeToastMessage", () => {
  it("formats coords only for UI nuke", () => {
    expect(formatNukeToastMessage(3, 7)).toBe("Nuke sent (3, 7)");
  });

  it("includes cost and radius when provided", () => {
    expect(
      formatNukeToastMessage(1, 2, {
        costCharged: 12,
        effectiveRadius: 1,
      }),
    ).toBe("Nuke sent (1, 2) · 12 pts · radius 1");
  });

  it("labels job source", () => {
    expect(formatNukeToastMessage(0, 0, { source: "job" })).toBe(
      "Nuke sent (0, 0) · job",
    );
  });
});

describe("computeCooldownEndsAtFromAccept", () => {
  it("adds NUKE_COOLDOWN_MS to event time", () => {
    const eventMs = 1_700_000_000_000;
    expect(computeCooldownEndsAtFromAccept(eventMs)).toBe(
      eventMs + NUKE_COOLDOWN_MS,
    );
  });
});

describe("computeCooldownEndsAtFromRetryAfter", () => {
  it("adds retry_after seconds to now", () => {
    const now = 1_700_000_000_000;
    expect(computeCooldownEndsAtFromRetryAfter(now, 28)).toBe(now + 28_000);
  });
});

describe("formatCooldownLabel", () => {
  it("shows remaining seconds while cooling down", () => {
    const endsAt = 1_000_050;
    expect(formatCooldownLabel(endsAt, 1_000_000)).toBe("Cooldown: 1s");
    expect(formatCooldownLabel(endsAt, 1_000_040)).toBe("Cooldown: 1s");
    expect(formatCooldownLabel(endsAt, 1_000_001)).toBe("Cooldown: 1s");
  });

  it("shows Ready when cooldown elapsed", () => {
    expect(formatCooldownLabel(1_000_000, 1_000_000)).toBe("Ready");
    expect(formatCooldownLabel(1_000_000, 1_000_100)).toBe("Ready");
  });
});

describe("fetchRecentNukes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs gateway recent nukes with since_id", async () => {
    const payload: RecentNukesResponse = {
      nukes: [
        {
          id: 5,
          ts: "2026-01-01T00:00:00.000Z",
          source: "job",
          target_x: 1,
          target_y: 2,
          accepted: true,
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchRecentNukes(4, 20)).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith(
      "/_gateway/recent-nukes?since_id=4&limit=20",
    );
  });

  it("throws when recent nukes are unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      }),
    );

    await expect(fetchRecentNukes(0)).rejects.toThrow(
      "recent nukes unavailable (503)",
    );
  });
});

describe("initNukeToast", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("shows UI accept immediately and dedupes matching poll row", async () => {
    vi.useFakeTimers();
    const now = Date.parse("2026-01-01T00:00:00.000Z");
    vi.setSystemTime(now);

    const root = document.createElement("aside");
    const fetchRecent = vi
      .fn()
      .mockResolvedValueOnce({ nukes: [] })
      .mockResolvedValueOnce({
        nukes: [
          {
            id: 10,
            ts: "2026-01-01T00:00:00.000Z",
            source: "ui",
            target_x: 4,
            target_y: 5,
            accepted: true,
            cost_charged: 8,
            effective_radius_tiles: 2,
          },
        ],
      })
      .mockResolvedValue({ nukes: [] });

    const handle = initNukeToast(root, {
      pollMs: 1000,
      fetchRecent,
    });
    await Promise.resolve();

    handle.notifyUiAccepted(4, 5, { cost_charged: 8, effective_radius_tiles: 2 });
    expect(root.querySelector(".nuke-toast-message")?.textContent).toBe(
      "Nuke sent (4, 5) · 8 pts · radius 2",
    );
    expect(root.querySelector(".nuke-toast-cooldown")?.textContent).toBe(
      "Cooldown: 30s",
    );

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchRecent).toHaveBeenCalledWith(0, 50);
    await vi.advanceTimersByTimeAsync(1000);
    expect(root.querySelector(".nuke-toast-message")?.textContent).toBe(
      "Nuke sent (4, 5) · 8 pts · radius 2",
    );

    handle.destroy();
  });

  it("shows job nuke from poll with job label", async () => {
    vi.useFakeTimers();
    const eventMs = Date.parse("2026-01-01T00:00:10.000Z");
    vi.setSystemTime(eventMs + 5000);

    const root = document.createElement("aside");
    const fetchRecent = vi
      .fn()
      .mockResolvedValueOnce({ nukes: [] })
      .mockResolvedValueOnce({
        nukes: [
          {
            id: 3,
            ts: "2026-01-01T00:00:10.000Z",
            source: "job",
            target_x: 9,
            target_y: 8,
            accepted: true,
            cost_charged: 5,
          },
        ],
      })
      .mockResolvedValue({ nukes: [] });

    const handle = initNukeToast(root, {
      pollMs: 1000,
      fetchRecent,
    });
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => {
      expect(root.querySelector(".nuke-toast-message")?.textContent).toBe(
        "Nuke sent (9, 8) · 5 pts · job",
      );
    });
    expect(root.querySelector(".nuke-toast-cooldown")?.textContent).toBe(
      "Cooldown: 24s",
    );

    handle.destroy();
  });

  it("updates cooldown from UI reject retry_after without changing message", async () => {
    const root = document.createElement("aside");
    const fetchRecent = vi.fn().mockResolvedValue({ nukes: [] });

    const handle = initNukeToast(root, {
      pollMs: 1000,
      fetchRecent,
    });
    await Promise.resolve();

    handle.notifyUiRejected(12);
    expect(root.querySelector(".nuke-toast-message")?.textContent).toBe("");
    expect(root.querySelector(".nuke-toast-cooldown")?.textContent).toBe(
      "Cooldown: 12s",
    );

    handle.destroy();
  });
});
