export class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefillMs: number;

  constructor(
    private readonly maxRps: number,
    private readonly burst: number = 1,
  ) {
    this.tokens = burst;
    this.lastRefillMs = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefillMs) / 1000;
    const added = elapsed * this.maxRps;
    this.tokens = Math.min(this.burst, this.tokens + added);
    this.lastRefillMs = now;
  }

  async acquire(): Promise<void> {
    for (;;) {
      if (this.tryAcquire()) {
        return;
      }
      this.refill();
      const waitMs = Math.ceil((1 - this.tokens) / this.maxRps * 1000);
      await new Promise((resolve) => setTimeout(resolve, Math.max(waitMs, 50)));
    }
  }

  tryAcquire(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}
