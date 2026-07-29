import { describe, expect, it } from "vitest";
import { formatCacheAge } from "./cacheAge.js";

describe("formatCacheAge", () => {
  it("formats recent cache timestamps", () => {
    const recent = new Date(Date.now() - 5000).toISOString();
    expect(formatCacheAge(recent)).toBe("5s ago");
  });

  it("handles missing timestamp", () => {
    expect(formatCacheAge(null)).toBe("cache age unknown");
  });
});
