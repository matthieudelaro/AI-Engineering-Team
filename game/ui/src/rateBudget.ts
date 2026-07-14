export interface RateLimitInfo {
  limit: number | null;
  remaining: number | null;
  reset: number | null;
}

export function parseRateLimitHeaders(response: Response): RateLimitInfo {
  const limit = response.headers.get("x-ratelimit-limit");
  const remaining = response.headers.get("x-ratelimit-remaining");
  const reset = response.headers.get("x-ratelimit-reset");
  return {
    limit: limit !== null ? Number.parseInt(limit, 10) : null,
    remaining: remaining !== null ? Number.parseInt(remaining, 10) : null,
    reset: reset !== null ? Number.parseInt(reset, 10) : null,
  };
}

/** Tracks place-tile rate budget using server headers + in-flight count. */
export class RateBudget {
  private limit: number | null = null;
  private remaining: number | null = null;
  private reset: number | null = null;
  private inFlight = 0;

  update(info: RateLimitInfo): void {
    if (info.limit !== null && !Number.isNaN(info.limit)) {
      this.limit = info.limit;
    }
    if (info.remaining !== null && !Number.isNaN(info.remaining)) {
      this.remaining = info.remaining;
    }
    if (info.reset !== null && !Number.isNaN(info.reset)) {
      this.reset = info.reset;
    }
  }

  getLimit(): number {
    return this.limit ?? 20;
  }

  getRemaining(): number {
    if (this.remaining !== null) {
      return Math.max(0, this.remaining);
    }
    return this.getLimit();
  }

  getAvailableSlots(): number {
    return Math.max(0, this.getRemaining() - this.inFlight);
  }

  beginClaim(): boolean {
    if (this.getAvailableSlots() <= 0) {
      return false;
    }
    this.inFlight++;
    return true;
  }

  onPlaceTileResponse(info: RateLimitInfo): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.update(info);
  }

  onPlaceTileError(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
  }

  label(): string {
    const cap = this.getLimit();
    const avail = this.getAvailableSlots();
    return `rate: ${avail} free · ${this.inFlight} in-flight / ${cap}`;
  }
}
