import type { Point } from "./joinTiles.js";

function key(x: number, y: number): string {
  return `${x},${y}`;
}

/** Recently claimed tiles that are still owned — newest first. */
export class RecentClaims {
  private readonly maxSize: number;
  private readonly entries: Point[] = [];

  constructor(maxSize = 24) {
    this.maxSize = maxSize;
  }

  record(x: number, y: number): void {
    const k = key(x, y);
    const existing = this.entries.findIndex((p) => key(p.x, p.y) === k);
    if (existing !== -1) {
      this.entries.splice(existing, 1);
    }
    this.entries.unshift({ x, y });
    if (this.entries.length > this.maxSize) {
      this.entries.length = this.maxSize;
    }
  }

  prune(isStillOwned: (x: number, y: number) => boolean): void {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const p = this.entries[i]!;
      if (!isStillOwned(p.x, p.y)) {
        this.entries.splice(i, 1);
      }
    }
  }

  getActive(): Point[] {
    return [...this.entries];
  }
}
