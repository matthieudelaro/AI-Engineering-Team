import {
  buildOwnershipMap,
  isNukedOwnership,
  ownerName,
  type MapResponse,
  type MapTile,
} from "../../jobs/shared.js";
import type { CellBelief, MapBounds, Point } from "./types.js";

/** Exponential decay half-life for cell confidence (ms). */
export const CONFIDENCE_HALF_LIFE_MS = 60_000;

/** Skip scouting cells we believe are ours above this threshold. */
export const HIGH_CONFIDENCE_THRESHOLD = 0.85;

/** Cells below this effective confidence are preferred scout targets. */
export const LOW_CONFIDENCE_THRESHOLD = 0.35;

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function computeDecayedConfidence(
  stored: number,
  lastSeenAt: number,
  nowMs: number,
): number {
  const age = Math.max(0, nowMs - lastSeenAt);
  // Half-life: confidence halves every CONFIDENCE_HALF_LIFE_MS.
  return stored * 0.5 ** (age / CONFIDENCE_HALF_LIFE_MS);
}

function tileBelief(tile: MapTile, nowMs: number): CellBelief {
  const nuked = isNukedOwnership(tile.ownership);
  const owner = nuked ? null : ownerName(tile.ownership);
  return {
    owner,
    nuked,
    lastSeenAt: nowMs,
    confidence: 1,
  };
}

export class MapBelief {
  private readonly cells = new Map<string, CellBelief>();
  private bounds: MapBounds;

  constructor(
    bounds: MapBounds,
    private readonly selfName: string | null,
  ) {
    this.bounds = { ...bounds };
  }

  getBounds(): MapBounds {
    return { ...this.bounds };
  }

  get(x: number, y: number): CellBelief | undefined {
    return this.cells.get(cellKey(x, y));
  }

  effectiveConfidence(x: number, y: number, nowMs: number): number {
    const cell = this.get(x, y);
    if (!cell) {
      return 0;
    }
    return computeDecayedConfidence(cell.confidence, cell.lastSeenAt, nowMs);
  }

  ingestMap(map: MapResponse, nowMs: number): void {
    this.bounds = { ...map.bounds };
    for (const tile of map.tiles) {
      this.cells.set(cellKey(tile.x, tile.y), tileBelief(tile, nowMs));
    }
  }

  noteClaimAccepted(selfName: string, x: number, y: number, nowMs: number): void {
    this.cells.set(cellKey(x, y), {
      owner: selfName,
      nuked: false,
      lastSeenAt: nowMs,
      confidence: 1,
    });
  }

  noteOutOfBounds(x: number, y: number): void {
    if (x >= this.bounds.max_x) {
      this.bounds.max_x = x - 1;
    }
    if (x <= this.bounds.min_x) {
      this.bounds.min_x = x + 1;
    }
    if (y >= this.bounds.max_y) {
      this.bounds.max_y = y - 1;
    }
    if (y <= this.bounds.min_y) {
      this.bounds.min_y = y + 1;
    }
  }

  /** Merge ownership snapshot without resetting lastSeen for unseen cells. */
  refreshFromTiles(tiles: MapTile[], nowMs: number): void {
    for (const tile of tiles) {
      this.cells.set(cellKey(tile.x, tile.y), tileBelief(tile, nowMs));
    }
  }

  private inBounds(x: number, y: number): boolean {
    return (
      x >= this.bounds.min_x &&
      x <= this.bounds.max_x &&
      y >= this.bounds.min_y &&
      y <= this.bounds.max_y
    );
  }

  private isScoutBlocked(x: number, y: number, nowMs: number): boolean {
    const cell = this.get(x, y);
    if (cell?.nuked) {
      return true;
    }
    if (cell?.owner === this.selfName) {
      return true;
    }
    if (
      cell &&
      cell.owner === this.selfName &&
      this.effectiveConfidence(x, y, nowMs) >= HIGH_CONFIDENCE_THRESHOLD
    ) {
      return true;
    }
    return false;
  }

  /**
   * Pick the stalest / unknown in-bounds cell for a scout probe.
   * Never targets cells we own or know with high confidence as ours.
   */
  pickScoutTarget(nowMs: number): Point | null {
    let best: Point | null = null;
    let bestScore = -1;

    for (let y = this.bounds.min_y; y <= this.bounds.max_y; y++) {
      for (let x = this.bounds.min_x; x <= this.bounds.max_x; x++) {
        if (this.isScoutBlocked(x, y, nowMs)) {
          continue;
        }
        const cell = this.get(x, y);
        if (cell?.nuked) {
          continue;
        }
        if (cell?.owner === this.selfName) {
          continue;
        }
        const eff = cell
          ? this.effectiveConfidence(x, y, nowMs)
          : 0;
        if (
          cell?.owner === this.selfName &&
          eff >= HIGH_CONFIDENCE_THRESHOLD
        ) {
          continue;
        }
        // Lower confidence → higher score; never-seen (0) beats stale.
        const score = 1 - eff + (cell ? 0 : 0.5);
        if (score > bestScore) {
          bestScore = score;
          best = { x, y };
        }
      }
    }

    return best;
  }

  /** Ownership sets derived from current belief (for planners). */
  deriveOwnership(): {
    owned: Set<string>;
    occupied: Map<string, string | null>;
    nuked: Set<string>;
  } {
    const owned = new Set<string>();
    const occupied = new Map<string, string | null>();
    const nuked = new Set<string>();
    for (const [key, cell] of this.cells) {
      if (cell.nuked) {
        nuked.add(key);
        occupied.set(key, null);
        continue;
      }
      occupied.set(key, cell.owner);
      if (cell.owner === this.selfName) {
        owned.add(key);
      }
    }
    return { owned, occupied, nuked };
  }

  /** Seed belief from a full map snapshot. */
  static fromMap(map: MapResponse, selfName: string | null, nowMs: number): MapBelief {
    const belief = new MapBelief(map.bounds, selfName);
    belief.ingestMap(map, nowMs);
    // Also mark tiles from buildOwnershipMap for consistency
    const { owned, occupied, nuked } = buildOwnershipMap(map.tiles, selfName);
    for (const key of owned) {
      belief.cells.set(key, {
        owner: selfName,
        nuked: false,
        lastSeenAt: nowMs,
        confidence: 1,
      });
    }
    for (const [key, owner] of occupied) {
      if (!belief.cells.has(key)) {
        belief.cells.set(key, {
          owner,
          nuked: nuked.has(key),
          lastSeenAt: nowMs,
          confidence: 1,
        });
      }
    }
    return belief;
  }
}
