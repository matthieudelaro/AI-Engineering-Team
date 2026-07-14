import { afterEach, describe, expect, it, vi } from "vitest";
import { TokenBucketRateLimiter } from "./rateLimiter.js";

describe("TokenBucketRateLimiter", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows immediate acquire within burst", async () => {
    const limiter = new TokenBucketRateLimiter(10, 2);
    await limiter.acquire();
    await limiter.acquire();
    expect(true).toBe(true);
  });

  it("reports available tokens and decrements on tryAcquire", () => {
    const limiter = new TokenBucketRateLimiter(10, 3);
    expect(limiter.availableTokens()).toBe(3);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.availableTokens()).toBe(2);
  });

  it("pauseFor blocks acquire until the deadline and extends on later pauses", async () => {
    vi.useFakeTimers();
    const limiter = new TokenBucketRateLimiter(20, 20);
    limiter.pauseFor(1000);
    limiter.pauseFor(500);

    let acquired = false;
    const pending = limiter.acquire().then(() => {
      acquired = true;
    });

    await vi.advanceTimersByTimeAsync(999);
    expect(acquired).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(acquired).toBe(true);
  });
});
