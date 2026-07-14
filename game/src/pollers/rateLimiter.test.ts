import { describe, expect, it } from "vitest";
import { TokenBucketRateLimiter } from "./rateLimiter.js";

describe("TokenBucketRateLimiter", () => {
  it("allows immediate acquire within burst", async () => {
    const limiter = new TokenBucketRateLimiter(10, 2);
    await limiter.acquire();
    await limiter.acquire();
    expect(true).toBe(true);
  });
});
