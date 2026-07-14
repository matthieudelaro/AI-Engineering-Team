import { describe, expect, it, vi } from "vitest";
import {
  addTileToBatch,
  drainBatch,
  tileKey,
  UiClaimBatcher,
  type TileCoord,
} from "./uiClaimBatch.js";

describe("tileKey", () => {
  it("formats coordinates as x,y", () => {
    expect(tileKey(3, -7)).toBe("3,-7");
  });
});

describe("addTileToBatch", () => {
  it("adds a tile once per coordinate", () => {
    const batch = new Map<string, TileCoord>();
    addTileToBatch(batch, 1, 2);
    addTileToBatch(batch, 1, 2);
    expect([...batch.values()]).toEqual([{ x: 1, y: 2 }]);
  });
});

describe("drainBatch", () => {
  it("returns accumulated tiles and clears the batch", () => {
    const batch = new Map<string, TileCoord>();
    addTileToBatch(batch, 0, 0);
    addTileToBatch(batch, 2, 3);
    expect(drainBatch(batch)).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 3 },
    ]);
    expect(batch.size).toBe(0);
  });
});

describe("UiClaimBatcher", () => {
  it("flushes enqueued tiles on the next scheduled tick", () => {
    const onFlush = vi.fn();
    let scheduled: (() => void) | null = null;
    const batcher = new UiClaimBatcher(onFlush, (fn) => {
      scheduled = fn;
    });

    batcher.enqueue(1, 1);
    batcher.enqueue(2, 2);
    expect(onFlush).not.toHaveBeenCalled();

    scheduled?.();
    expect(onFlush).toHaveBeenCalledOnce();
    expect(onFlush).toHaveBeenCalledWith([
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
  });

  it("dedupes coordinates within one flush window", () => {
    const onFlush = vi.fn();
    let scheduled: (() => void) | null = null;
    const batcher = new UiClaimBatcher(onFlush, (fn) => {
      scheduled = fn;
    });

    batcher.enqueue(4, 5);
    batcher.enqueue(4, 5);
    scheduled?.();
    expect(onFlush).toHaveBeenCalledWith([{ x: 4, y: 5 }]);
  });

  it("flushNow sends pending tiles immediately", () => {
    const onFlush = vi.fn();
    const batcher = new UiClaimBatcher(onFlush, () => {
      // never auto-run
    });

    batcher.enqueue(7, 8);
    batcher.flushNow();
    expect(onFlush).toHaveBeenCalledWith([{ x: 7, y: 8 }]);
  });

  it("does not call onFlush when nothing is pending", () => {
    const onFlush = vi.fn();
    const batcher = new UiClaimBatcher(onFlush, (fn) => fn());

    batcher.flushNow();
    expect(onFlush).not.toHaveBeenCalled();
  });
});
