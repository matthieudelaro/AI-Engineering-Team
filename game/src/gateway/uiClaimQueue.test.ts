import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ackUiClaimTiles,
  clearUiClaimQueue,
  enqueueUiClaimTiles,
  getUiClaimQueueStats,
  reclaimUiClaimInFlight,
  requeueUiClaimTilesFront,
  resetUiClaimQueue,
  scheduleUiClaimRetry,
  takeUiClaimTiles,
  UI_CLAIM_RETRY_WINDOW_MS,
} from "./uiClaimQueue.js";

describe("uiClaimQueue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetUiClaimQueue();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("enqueue dedupes by x,y while pending", () => {
    enqueueUiClaimTiles([{ x: 1, y: 2 }, { x: 1, y: 2 }, { x: 3, y: 4 }]);

    expect(takeUiClaimTiles(10)).toEqual([
      { x: 1, y: 2, isRetry: false },
      { x: 3, y: 4, isRetry: false },
    ]);
    expect(takeUiClaimTiles(10)).toEqual([]);
  });

  it("enqueue refuses tiles that are already in-flight", () => {
    enqueueUiClaimTiles([{ x: 1, y: 2 }]);
    takeUiClaimTiles(1);
    enqueueUiClaimTiles([{ x: 1, y: 2 }, { x: 3, y: 4 }]);

    expect(takeUiClaimTiles(10)).toEqual([{ x: 3, y: 4, isRetry: false }]);
    ackUiClaimTiles([{ x: 1, y: 2 }]);
    enqueueUiClaimTiles([{ x: 1, y: 2 }]);
    expect(takeUiClaimTiles(10)).toEqual([{ x: 1, y: 2, isRetry: false }]);
  });

  it("take returns tiles in fifo order", () => {
    enqueueUiClaimTiles([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]);

    expect(takeUiClaimTiles(2)).toEqual([
      { x: 0, y: 0, isRetry: false },
      { x: 1, y: 0, isRetry: false },
    ]);
    expect(takeUiClaimTiles(10)).toEqual([{ x: 2, y: 0, isRetry: false }]);
  });

  it("drops expired retries at the head then continues fifo", () => {
    enqueueUiClaimTiles([{ x: 1, y: 1 }]);
    takeUiClaimTiles(1);
    scheduleUiClaimRetry(1, 1, 1000);
    enqueueUiClaimTiles([{ x: 2, y: 2 }]);

    expect(takeUiClaimTiles(10, 1000 + UI_CLAIM_RETRY_WINDOW_MS + 1)).toEqual([
      { x: 2, y: 2, isRetry: false },
    ]);
  });

  it("requeueUiClaimTilesFront restores order at the head", () => {
    enqueueUiClaimTiles([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
    const taken = takeUiClaimTiles(2);
    expect(taken).toEqual([
      { x: 1, y: 0, isRetry: false },
      { x: 2, y: 0, isRetry: false },
    ]);

    requeueUiClaimTilesFront([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]);

    expect(takeUiClaimTiles(10)).toEqual([
      { x: 1, y: 0, isRetry: false },
      { x: 2, y: 0, isRetry: false },
      { x: 3, y: 0, isRetry: false },
    ]);
  });

  it("scheduleUiClaimRetry re-enqueues a rejected tile as a retry", () => {
    enqueueUiClaimTiles([{ x: 5, y: 6 }]);
    takeUiClaimTiles(1);

    scheduleUiClaimRetry(5, 6, 1000);

    expect(takeUiClaimTiles(10, 1000)).toEqual([{ x: 5, y: 6, isRetry: true }]);
  });

  it("allows retry take before the deadline elapses", () => {
    const scheduledAt = 1000;
    enqueueUiClaimTiles([{ x: 2, y: 3 }]);
    takeUiClaimTiles(1, scheduledAt);
    scheduleUiClaimRetry(2, 3, scheduledAt);

    const beforeDeadline = scheduledAt + UI_CLAIM_RETRY_WINDOW_MS - 1;
    expect(takeUiClaimTiles(10, beforeDeadline)).toEqual([
      { x: 2, y: 3, isRetry: true },
    ]);
  });

  it("ignores retry when tile is already pending", () => {
    enqueueUiClaimTiles([{ x: 4, y: 5 }]);

    expect(scheduleUiClaimRetry(4, 5, 1000)).toBe(false);
    expect(takeUiClaimTiles(10, 1000)).toEqual([{ x: 4, y: 5, isRetry: false }]);
  });

  it("ignores a second retry for the same tile", () => {
    enqueueUiClaimTiles([{ x: 7, y: 8 }]);
    takeUiClaimTiles(1);
    expect(scheduleUiClaimRetry(7, 8, 1000)).toBe(true);
    takeUiClaimTiles(1, 1000);

    expect(scheduleUiClaimRetry(7, 8, 1100)).toBe(false);
    expect(takeUiClaimTiles(10, 1100)).toEqual([]);
  });

  it("fresh enqueue restores retry budget after a consumed retry", () => {
    enqueueUiClaimTiles([{ x: 9, y: 9 }]);
    takeUiClaimTiles(1);
    expect(scheduleUiClaimRetry(9, 9, 1000)).toBe(true);
    takeUiClaimTiles(1, 1000);
    ackUiClaimTiles([{ x: 9, y: 9 }]);
    expect(scheduleUiClaimRetry(9, 9, 1100)).toBe(false);

    enqueueUiClaimTiles([{ x: 9, y: 9 }]);
    takeUiClaimTiles(1);
    expect(scheduleUiClaimRetry(9, 9, 2000)).toBe(true);
    expect(takeUiClaimTiles(10, 2000)).toEqual([{ x: 9, y: 9, isRetry: true }]);
  });

  it("requeue after rate limit does not burn soft-reject retry", () => {
    enqueueUiClaimTiles([{ x: 1, y: 1 }]);
    takeUiClaimTiles(1);
    requeueUiClaimTilesFront([{ x: 1, y: 1 }]);

    expect(takeUiClaimTiles(10)).toEqual([{ x: 1, y: 1, isRetry: false }]);
    expect(scheduleUiClaimRetry(1, 1, 1000)).toBe(true);
  });

  it("reclaimUiClaimInFlight returns orphaned leases to the pending front", () => {
    enqueueUiClaimTiles([
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ]);
    takeUiClaimTiles(2);
    expect(getUiClaimQueueStats()).toMatchObject({ pending: 1, inFlight: 2 });

    expect(reclaimUiClaimInFlight()).toBe(2);
    expect(getUiClaimQueueStats()).toMatchObject({ pending: 3, inFlight: 0 });
    expect(takeUiClaimTiles(10)).toEqual([
      { x: 1, y: 1, isRetry: false },
      { x: 2, y: 2, isRetry: false },
      { x: 3, y: 3, isRetry: false },
    ]);
  });

  it("reset clears the queue for tests", () => {
    enqueueUiClaimTiles([{ x: 1, y: 1 }]);
    resetUiClaimQueue();
    expect(takeUiClaimTiles(10)).toEqual([]);
  });

  describe("getUiClaimQueueStats", () => {
    it("reports zero counts on an empty queue", () => {
      expect(getUiClaimQueueStats()).toEqual({
        pending: 0,
        inFlight: 0,
        total: 0,
        pendingRetries: 0,
        head: [],
      });
    });

    it("reports pending counts and fifo head preview after enqueue", () => {
      enqueueUiClaimTiles([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ]);

      expect(getUiClaimQueueStats()).toEqual({
        pending: 3,
        inFlight: 0,
        total: 3,
        pendingRetries: 0,
        head: [
          { x: 0, y: 0, isRetry: false },
          { x: 1, y: 0, isRetry: false },
          { x: 2, y: 0, isRetry: false },
        ],
      });
    });

    it("moves taken tiles to in-flight in stats", () => {
      enqueueUiClaimTiles([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ]);
      takeUiClaimTiles(2);

      expect(getUiClaimQueueStats()).toEqual({
        pending: 1,
        inFlight: 2,
        total: 3,
        pendingRetries: 0,
        head: [{ x: 2, y: 0, isRetry: false }],
      });
    });

    it("counts pending retries and includes them in head preview", () => {
      enqueueUiClaimTiles([{ x: 5, y: 6 }]);
      takeUiClaimTiles(1);
      scheduleUiClaimRetry(5, 6, 1000);
      enqueueUiClaimTiles([{ x: 7, y: 8 }]);

      expect(getUiClaimQueueStats()).toEqual({
        pending: 2,
        inFlight: 0,
        total: 2,
        pendingRetries: 1,
        head: [
          { x: 5, y: 6, isRetry: true },
          { x: 7, y: 8, isRetry: false },
        ],
      });
    });

    it("limits head preview to ten pending tiles", () => {
      enqueueUiClaimTiles(
        Array.from({ length: 12 }, (_, i) => ({ x: i, y: 0 })),
      );

      const stats = getUiClaimQueueStats();
      expect(stats.pending).toBe(12);
      expect(stats.head).toHaveLength(10);
      expect(stats.head[0]).toEqual({ x: 0, y: 0, isRetry: false });
      expect(stats.head[9]).toEqual({ x: 9, y: 0, isRetry: false });
    });
  });

  describe("clearUiClaimQueue", () => {
    it("empties pending and in-flight state", () => {
      enqueueUiClaimTiles([
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ]);
      takeUiClaimTiles(1);

      clearUiClaimQueue();

      expect(getUiClaimQueueStats()).toEqual({
        pending: 0,
        inFlight: 0,
        total: 0,
        pendingRetries: 0,
        head: [],
      });
      expect(takeUiClaimTiles(10)).toEqual([]);
    });

    it("restores retry budget after clear", () => {
      enqueueUiClaimTiles([{ x: 9, y: 9 }]);
      takeUiClaimTiles(1);
      scheduleUiClaimRetry(9, 9, 1000);
      takeUiClaimTiles(1, 1000);
      ackUiClaimTiles([{ x: 9, y: 9 }]);
      expect(scheduleUiClaimRetry(9, 9, 1100)).toBe(false);

      clearUiClaimQueue();
      enqueueUiClaimTiles([{ x: 9, y: 9 }]);
      takeUiClaimTiles(1);
      expect(scheduleUiClaimRetry(9, 9, 2000)).toBe(true);
    });
  });
});
