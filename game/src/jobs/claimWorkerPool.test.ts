import { describe, expect, it } from "vitest";
import {
  canStartUiBridgeStep,
  isInvalidTarget,
  isOutOfBounds,
  resolvePlaceTileOutcome,
} from "./claimWorkerPool.js";
import {
  findNextAdjacentUiClaimIndex,
  pickBridgeStepToward,
  type MapResponse,
} from "./shared.js";

function mapWithOwned(owned: Array<{ x: number; y: number }>): MapResponse {
  return {
    bounds: { min_x: -10, max_x: 10, min_y: -10, max_y: 10 },
    tiles: owned.map((p) => ({
      x: p.x,
      y: p.y,
      ownership: { owned: "Me" },
    })),
  };
}

describe("isInvalidTarget", () => {
  it("matches INVALID_TARGET rejections", () => {
    expect(isInvalidTarget("REJECTION_REASON_INVALID_TARGET")).toBe(true);
    expect(isInvalidTarget("other")).toBe(false);
    expect(isInvalidTarget(undefined)).toBe(false);
  });
});

describe("isOutOfBounds", () => {
  it("matches OUT_OF_BOUNDS rejections", () => {
    expect(isOutOfBounds("REJECTION_REASON_OUT_OF_BOUNDS")).toBe(true);
    expect(isOutOfBounds("other")).toBe(false);
    expect(isOutOfBounds(undefined)).toBe(false);
  });
});

describe("resolvePlaceTileOutcome", () => {
  it("returns success when place-tile accepted", () => {
    expect(resolvePlaceTileOutcome({ ok: true }, true, false)).toEqual({
      action: "success",
    });
  });

  it("retries the same tile on rate limit", () => {
    expect(
      resolvePlaceTileOutcome(
        {
          ok: false,
          rateLimited: true,
          rejected: { reason: "REJECTION_REASON_RATE_LIMITED", retry_after: 2 },
        },
        true,
        false,
      ),
    ).toEqual({ action: "retry_rate_limit", waitMs: 2000 });
  });

  it("gives up on invalid targets", () => {
    expect(
      resolvePlaceTileOutcome(
        {
          ok: false,
          rejected: { reason: "REJECTION_REASON_INVALID_TARGET" },
        },
        true,
        false,
      ),
    ).toEqual({ action: "give_up" });
  });

  it("soft-retries other UI rejects once", () => {
    expect(
      resolvePlaceTileOutcome(
        {
          ok: false,
          rejected: { reason: "REJECTION_REASON_OCCUPIED" },
        },
        true,
        false,
      ),
    ).toEqual({ action: "soft_retry" });

    expect(
      resolvePlaceTileOutcome(
        {
          ok: false,
          rejected: { reason: "REJECTION_REASON_OCCUPIED" },
        },
        true,
        true,
      ),
    ).toEqual({ action: "give_up" });
  });
});

describe("canStartUiBridgeStep", () => {
  it("allows a bridge when nothing is in flight", () => {
    expect(canStartUiBridgeStep(0, 0)).toBe(true);
  });

  it("blocks a bridge while workers are active", () => {
    expect(canStartUiBridgeStep(1, 0)).toBe(false);
  });

  it("blocks a bridge while cells are reserved", () => {
    expect(canStartUiBridgeStep(0, 1)).toBe(false);
  });
});

describe("UI queue bridge gating", () => {
  it("must not bridge beside the line while a queue tip is pending", () => {
    const map = mapWithOwned([{ x: 0, y: 0 }]);
    const owned = new Set(["0,0"]);
    const work = [
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ];
    const pending = new Set(["1,0"]);

    expect(
      findNextAdjacentUiClaimIndex(work, 0, map, "Me", owned, pending),
    ).toBeNull();
    expect(canStartUiBridgeStep(0, pending.size)).toBe(false);

    // Without the gate, bridge BFS detours around the reserved tip.
    const detour = pickBridgeStepToward(
      map,
      "Me",
      work,
      owned,
      pending,
    );
    expect(detour).not.toEqual({ x: 1, y: 0 });
    expect(detour).not.toBeNull();
  });
});
