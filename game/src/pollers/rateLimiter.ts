export class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefillMs: number;
  /** Wall-clock ms; acquire blocks until this time after a rate-limit pause. */
  private pausedUntilMs = 0;

  constructor(
    private readonly maxRps: number,
    private readonly burst: number = 1,
  ) {
    this.tokens = burst;
    this.lastRefillMs = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    if (now < this.pausedUntilMs) {
      this.lastRefillMs = now;
      return;
    }
    const elapsed = (now - this.lastRefillMs) / 1000;
    const added = elapsed * this.maxRps;
    this.tokens = Math.min(this.burst, this.tokens + added);
    this.lastRefillMs = now;
  }

  /** Whole tokens currently available (after refill). */
  availableTokens(): number {
    this.refill();
    return Math.floor(this.tokens);
  }

  async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now();
      if (now < this.pausedUntilMs) {
        await new Promise((resolve) =>
          setTimeout(resolve, this.pausedUntilMs - now),
        );
        continue;
      }
      if (this.tryAcquire()) {
        return;
      }
      this.refill();
      const waitMs = Math.ceil((1 - this.tokens) / this.maxRps * 1000);
      // Floor at 5ms so we can actually approach maxRps (50ms floor capped us).
      await new Promise((resolve) => setTimeout(resolve, Math.max(waitMs, 5)));
    }
  }

  tryAcquire(): boolean {
    if (Date.now() < this.pausedUntilMs) {
      return false;
    }
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /** Drop accumulated tokens after a 429 so we don't burst into the next window. */
  drain(): void {
    this.tokens = 0;
    this.lastRefillMs = Date.now();
  }

  /**
   * Coordinated backoff: zero the bucket and block all acquires until `waitMs`
   * elapses. Repeated calls extend to the latest deadline (no stampede sleeps).
   */
  pauseFor(waitMs: number): void {
    const until = Date.now() + Math.max(0, waitMs);
    this.tokens = 0;
    this.lastRefillMs = Date.now();
    this.pausedUntilMs = Math.max(this.pausedUntilMs, until);
  }
}
