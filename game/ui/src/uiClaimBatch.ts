export interface TileCoord {
  x: number;
  y: number;
}

export function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function addTileToBatch(
  batch: Map<string, TileCoord>,
  x: number,
  y: number,
): void {
  const key = tileKey(x, y);
  if (!batch.has(key)) {
    batch.set(key, { x, y });
  }
}

export function drainBatch(batch: Map<string, TileCoord>): TileCoord[] {
  const tiles = [...batch.values()];
  batch.clear();
  return tiles;
}

type ScheduleFn = (callback: () => void) => void;

export class UiClaimBatcher {
  private readonly batch = new Map<string, TileCoord>();
  private scheduled = false;

  constructor(
    private readonly onFlush: (tiles: TileCoord[]) => void,
    private readonly schedule: ScheduleFn = (callback) => {
      requestAnimationFrame(callback);
    },
  ) {}

  enqueue(x: number, y: number): void {
    addTileToBatch(this.batch, x, y);
    if (this.scheduled) {
      return;
    }
    this.scheduled = true;
    this.schedule(() => {
      this.scheduled = false;
      const tiles = drainBatch(this.batch);
      if (tiles.length > 0) {
        this.onFlush(tiles);
      }
    });
  }

  flushNow(): void {
    this.scheduled = false;
    const tiles = drainBatch(this.batch);
    if (tiles.length > 0) {
      this.onFlush(tiles);
    }
  }
}
