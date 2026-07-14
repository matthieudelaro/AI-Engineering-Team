import { describe, expect, it } from "vitest";
import {
  isInvalidTarget,
  resolvePlaceTileOutcome,
} from "./claimWorkerPool.js";

describe("isInvalidTarget", () => {
  it("matches INVALID_TARGET rejections", () => {
    expect(isInvalidTarget("REJECTION_REASON_INVALID_TARGET")).toBe(true);
    expect(isInvalidTarget("other")).toBe(false);
    expect(isInvalidTarget(undefined)).toBe(false);
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
