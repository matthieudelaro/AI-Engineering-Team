import { describe, expect, it } from "vitest";
import { isPlaceTileRateLimited, msUntilRateLimitReset } from "./shared.js";

describe("isPlaceTileRateLimited", () => {
  it("detects HTTP 429", () => {
    expect(isPlaceTileRateLimited(undefined, 429)).toBe(true);
  });

  it("detects REJECTION_REASON_RATE_LIMITED", () => {
    expect(isPlaceTileRateLimited("REJECTION_REASON_RATE_LIMITED")).toBe(true);
  });

  it("ignores other rejection reasons", () => {
    expect(isPlaceTileRateLimited("REJECTION_REASON_COOLDOWN")).toBe(false);
    expect(isPlaceTileRateLimited("REJECTION_REASON_INSUFFICIENT_POINTS")).toBe(false);
    expect(isPlaceTileRateLimited(undefined, 409)).toBe(false);
  });
});

describe("msUntilRateLimitReset", () => {
  it("uses X-RateLimit-Reset unix timestamp when present", () => {
    const now = 1_700_000_000_000;
    const resetSec = Math.floor(now / 1000) + 2;
    expect(msUntilRateLimitReset(resetSec, 1, now)).toBe(2000 + 25);
  });

  it("falls back to retry_after seconds", () => {
    expect(msUntilRateLimitReset(undefined, 3, 0)).toBe(3000);
  });

  it("defaults to 1s when nothing is provided", () => {
    expect(msUntilRateLimitReset(undefined, undefined, 0)).toBe(1000);
  });
});
