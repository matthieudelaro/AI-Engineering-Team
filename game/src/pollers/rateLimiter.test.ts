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

  it("soft-resumes at reduced RPS after pauseFor ends", async () => {
    vi.useFakeTimers();
    const limiter = new TokenBucketRateLimiter(20, 1, 8, 400);
    limiter.pauseFor(100);

    let acquired = 0;
    let stop = false;
    const loop = (async () => {
      while (!stop) {
        await limiter.acquire();
        acquired += 1;
      }
    })();

    await vi.advanceTimersByTimeAsync(100); // end pause
    // 250ms of soft-resume at ~8/s → about 2 tokens (not ~5 at 20/s).
    await vi.advanceTimersByTimeAsync(250);
    expect(acquired).toBeGreaterThanOrEqual(1);
    expect(acquired).toBeLessThanOrEqual(3);

    stop = true;
    // Unblock the waiting acquire so the loop can exit.
    await vi.advanceTimersByTimeAsync(1000);
    await loop;
  });

  it("noteRemaining slows when remaining is low", async () => {
    vi.useFakeTimers();
    const limiter = new TokenBucketRateLimiter(20, 1, 8, 400);
    await limiter.acquire();
    limiter.noteRemaining(2);

    let acquired = false;
    const pending = limiter.acquire().then(() => {
      acquired = true;
    });

    // Soft-resume RPS = 2 → ~500ms per token.
    await vi.advanceTimersByTimeAsync(400);
    expect(acquired).toBe(false);

    await vi.advanceTimersByTimeAsync(150);
    await pending;
    expect(acquired).toBe(true);
  });

  it("caps starts per wall-clock second then waits for the next second", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.100Z"));
    const limiter = new TokenBucketRateLimiter(3, 3);

    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();

    let fourth = false;
    const pending = limiter.acquire().then(() => {
      fourth = true;
    });

    await vi.advanceTimersByTimeAsync(800);
    expect(fourth).toBe(false);

    await vi.advanceTimersByTimeAsync(200);
    await pending;
    expect(fourth).toBe(true);
  });
});
