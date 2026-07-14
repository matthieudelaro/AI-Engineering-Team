type ClaimHandler = (x: number, y: number) => void;

export class ClaimQueue {
  private readonly queue: Array<{ x: number; y: number }> = [];
  private readonly inFlight = new Set<string>();
  private readonly claimed = new Set<string>();
  private draining = false;

  constructor(
    private readonly handler: ClaimHandler,
    private readonly intervalMs: number,
  ) {}

  private key(x: number, y: number): string {
    return `${x},${y}`;
  }

  enqueue(x: number, y: number): void {
    const k = this.key(x, y);
    if (this.inFlight.has(k) || this.claimed.has(k)) {
      return;
    }
    if (this.queue.some((item) => item.x === x && item.y === y)) {
      return;
    }
    this.queue.push({ x, y });
    void this.drain();
  }

  markOwned(x: number, y: number): void {
    this.claimed.add(this.key(x, y));
  }

  unmarkOwned(x: number, y: number): void {
    this.claimed.delete(this.key(x, y));
  }

  clearClaimed(): void {
    this.claimed.clear();
  }

  private async drain(): Promise<void> {
    if (this.draining) {
      return;
    }
    this.draining = true;
    while (this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next) {
        break;
      }
      const k = this.key(next.x, next.y);
      if (this.inFlight.has(k) || this.claimed.has(k)) {
        continue;
      }
      this.inFlight.add(k);
      try {
        this.handler(next.x, next.y);
      } finally {
        this.inFlight.delete(k);
      }
      if (this.intervalMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.intervalMs));
      }
    }
    this.draining = false;
  }
}
