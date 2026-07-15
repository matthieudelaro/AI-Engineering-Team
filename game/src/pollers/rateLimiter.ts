export class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefillMs: number;
  /** Wall-clock ms; acquire blocks until this time after a rate-limit pause. */
  private pausedUntilMs = 0;
  /** After a pause, use reduced RPS until this time to avoid stampede. */
  private softResumeUntilMs = 0;
  private softResumeRps: number | null = null;
  /** Aligns with typical API fixed windows (starts per unix second). */
  private windowSec = -1;
  private windowStarts = 0;

  constructor(
    private readonly maxRps: number,
    private readonly burst: number = 1,
    /** RPS cap during soft-resume window after pauseFor. */
    private readonly softResumeRpsDefault: number = 4,
    /** How long soft-resume lasts after pause ends. */
    private readonly softResumeMs: number = 1000,
  ) {
    this.tokens = burst;
    this.lastRefillMs = Date.now();
  }

  private effectiveRps(now: number = Date.now()): number {
    if (now < this.softResumeUntilMs && this.softResumeRps !== null) {
      return this.softResumeRps;
    }
    return this.maxRps;
  }

  private syncWindow(now: number): number {
    const sec = Math.floor(now / 1000);
    if (sec !== this.windowSec) {
      this.windowSec = sec;
      this.windowStarts = 0;
    }
    return Math.max(1, Math.floor(this.effectiveRps(now)));
  }

  private refill(): void {
    const now = Date.now();
    if (now < this.pausedUntilMs) {
      this.lastRefillMs = now;
      return;
    }
    const elapsed = (now - this.lastRefillMs) / 1000;
    const rps = this.effectiveRps(now);
    const added = elapsed * rps;
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
      const cap = this.syncWindow(Date.now());
      if (this.windowStarts >= cap) {
        // Wait for the next wall-clock second instead of 429'ing the API.
        const msToNextSec = 1000 - (Date.now() % 1000) + 1;
        await new Promise((resolve) => setTimeout(resolve, msToNextSec));
        continue;
      }
      this.refill();
      const rps = this.effectiveRps();
      const waitMs = Math.ceil((1 - this.tokens) / rps * 1000);
      // Floor at 5ms so we can actually approach maxRps (50ms floor capped us).
      await new Promise((resolve) => setTimeout(resolve, Math.max(waitMs, 5)));
    }
  }

  tryAcquire(): boolean {
    const now = Date.now();
    if (now < this.pausedUntilMs) {
      return false;
    }
    const cap = this.syncWindow(now);
    if (this.windowStarts >= cap) {
      return false;
    }
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      this.windowStarts += 1;
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
   * Short pauses soft-resume; long waits (into the next API window) resume at
   * full paced RPS so we don't spend an extra second at 4–8/s.
   */
  pauseFor(waitMs: number): void {
    // Never block the pool for more than 2s — bad Reset headers used to hang jobs.
    const capped = Math.min(2_000, Math.max(0, waitMs));
    const until = Date.now() + capped;
    this.tokens = 0;
    this.lastRefillMs = Date.now();
    this.pausedUntilMs = Math.max(this.pausedUntilMs, until);
    if (capped < 250) {
      this.softResumeRps = Math.min(this.softResumeRpsDefault, this.maxRps);
      this.softResumeUntilMs = Math.max(
        this.softResumeUntilMs,
        this.pausedUntilMs + this.softResumeMs,
      );
    } else {
      // Window wait already serialized the pool — resume at full pace.
      this.softResumeUntilMs = 0;
      this.softResumeRps = null;
    }
  }

  /**
   * Proactive throttle from X-RateLimit-Remaining. Slows starts before we hit 0
   * instead of slamming into RATE_LIMITED.
   */
  noteRemaining(remaining: number | undefined): void {
    if (typeof remaining !== "number" || !Number.isFinite(remaining)) {
      return;
    }
    if (remaining <= 0) {
      this.tokens = 0;
      // Pause until the next wall-clock second (API fixed windows align to it).
      const msToNextSec = 1000 - (Date.now() % 1000) + 5;
      this.pauseFor(msToNextSec);
      return;
    }
    if (remaining <= 3) {
      this.tokens = Math.min(this.tokens, 0);
      const now = Date.now();
      this.softResumeRps = Math.min(
        this.softResumeRps ?? this.maxRps,
        Math.max(1, remaining),
      );
      this.softResumeUntilMs = Math.max(this.softResumeUntilMs, now + 500);
    }
  }
}
