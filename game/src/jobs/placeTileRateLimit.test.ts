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
    expect(msUntilRateLimitReset(resetSec, 1, now)).toBe(2000 + 50);
  });

  it("falls back to retry_after seconds", () => {
    expect(msUntilRateLimitReset(undefined, 3, 0)).toBe(3000);
  });

  it("waits until the next wall-clock second when reset is already elapsed", () => {
    const now = 1_700_000_000_400; // 400ms into the second
    const resetSec = Math.floor(now / 1000); // current second
    expect(msUntilRateLimitReset(resetSec, 0, now)).toBe(1000 - 400 + 50);
  });

  it("treats retry_after: 0 as wait-until-next-second", () => {
    const now = 1_700_000_000_200;
    expect(msUntilRateLimitReset(undefined, 0, now)).toBe(1000 - 200 + 50);
  });

  it("defaults to wait-until-next-second when nothing is provided", () => {
    const now = 1_700_000_000_100;
    expect(msUntilRateLimitReset(undefined, undefined, now)).toBe(1000 - 100 + 50);
  });
});
