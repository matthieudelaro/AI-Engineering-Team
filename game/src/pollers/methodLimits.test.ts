import { describe, expect, it } from "vitest";
import {
  maxPerSecForEndpoint,
  pollIntervalMsForRps,
} from "./methodLimits.js";

describe("methodLimits", () => {
  it("uses API limit key when available", () => {
    const rps = maxPerSecForEndpoint(
      { get_flags: { max_per_sec: 20 } },
      "flags",
      "get_flags",
    );
    expect(rps).toBe(20);
  });

  it("falls back to configured maxPerSec", () => {
    const rps = maxPerSecForEndpoint(null, "flags", undefined, 15, 2);
    expect(rps).toBe(15);
  });

  it("computes poll interval from rps", () => {
    expect(pollIntervalMsForRps(20)).toBe(50);
    expect(pollIntervalMsForRps(2)).toBe(500);
  });
});
