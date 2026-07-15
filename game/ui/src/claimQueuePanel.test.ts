/** @vitest-environment happy-dom */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildClaimQueueView,
  clearClaimQueue,
  fetchClaimQueueStats,
  initClaimQueuePanel,
  type ClaimQueueStatsPayload,
} from "./claimQueuePanel.js";

const sampleStats: ClaimQueueStatsPayload = {
  pending: 3,
  inFlight: 2,
  total: 5,
  pendingRetries: 1,
};

describe("buildClaimQueueView", () => {
  it("formats meta summary from stats", () => {
    expect(buildClaimQueueView(sampleStats)).toEqual({
      meta: "3 pending · 2 in flight · 5 total",
      emptyDisabled: false,
    });
  });

  it("marks empty when total is zero", () => {
    const view = buildClaimQueueView({
      pending: 0,
      inFlight: 0,
      total: 0,
      pendingRetries: 0,
    });
    expect(view.meta).toBe("Queue empty");
    expect(view.emptyDisabled).toBe(true);
  });
});

describe("fetchClaimQueueStats", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs gateway stats JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => sampleStats,
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchClaimQueueStats()).resolves.toEqual(sampleStats);
    expect(fetchMock).toHaveBeenCalledWith("/_gateway/ui-claim-queue");
  });

  it("throws when stats are unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      }),
    );

    await expect(fetchClaimQueueStats()).rejects.toThrow("claim queue stats unavailable (503)");
  });
});

describe("clearClaimQueue", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("DELETEs the gateway queue", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
    });
    vi.stubGlobal("fetch", fetchMock);

    await clearClaimQueue();
    expect(fetchMock).toHaveBeenCalledWith("/_gateway/ui-claim-queue", {
      method: "DELETE",
      headers: { "X-Source": "ui" },
    });
  });

  it("throws when clear fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Server Error",
      }),
    );

    await expect(clearClaimQueue()).rejects.toThrow("clear claim queue failed (500)");
  });
});

describe("initClaimQueuePanel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders stats and clears the queue from the button", async () => {
    const root = document.createElement("aside");
    const clearQueue = vi.fn().mockResolvedValue(undefined);
    const onCleared = vi.fn();
    const fetchStats = vi
      .fn()
      .mockResolvedValueOnce(sampleStats)
      .mockResolvedValueOnce({
        pending: 0,
        inFlight: 0,
        total: 0,
        pendingRetries: 0,
      });

    const cleanup = initClaimQueuePanel(root, {
      pollMs: 60_000,
      fetchStats,
      clearQueue,
      onCleared,
    });
    await Promise.resolve();

    expect(root.querySelector(".claim-queue-panel-title")?.textContent).toBe("Claim queue");
    expect(root.querySelector(".claim-queue-panel-meta")?.textContent).toBe(
      "3 pending · 2 in flight · 5 total",
    );
    expect(root.querySelector(".claim-queue-panel-head")).toBeNull();

    const button = root.querySelector("button");
    expect(button?.disabled).toBe(false);
    button?.click();

    await vi.waitFor(() => {
      expect(fetchStats).toHaveBeenCalledTimes(2);
    });
    expect(clearQueue).toHaveBeenCalledOnce();
    expect(onCleared).toHaveBeenCalledOnce();
    expect(root.querySelector(".claim-queue-panel-meta")?.textContent).toBe("Queue empty");
    expect(button?.disabled).toBe(true);

    cleanup();
  });
});
