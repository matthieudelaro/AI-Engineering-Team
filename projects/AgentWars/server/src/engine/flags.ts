import {
  FLAG_DENSITY_DIVISOR,
  FLAG_POT_INTERVAL_MS,
} from "./constants.js";
import type { GridBounds } from "./grid.js";
import type { Grid } from "./grid.js";

export interface FlagState {
  id: string;
  x: number;
  y: number;
  /** Pot value materialized at `createdAtMs`. */
  frozenPot: number;
  /** Anchor for lazy pot growth (advanced on materialize). */
  createdAtMs: number;
  nuked: boolean;
  ownerId: number | null;
  lockedOwnerId: number | null;
}

export function targetFlagCount(mapSize: number): number {
  if (mapSize <= 11) {
    return 0;
  }
  return Math.round((mapSize * mapSize) / FLAG_DENSITY_DIVISOR);
}

export function createFlag(x: number, y: number, nowMs: number): FlagState {
  return {
    id: `${x},${y}`,
    x,
    y,
    frozenPot: 0,
    createdAtMs: nowMs,
    nuked: false,
    ownerId: null,
    lockedOwnerId: null,
  };
}

export function computePot(flag: FlagState, nowMs: number): number {
  if (flag.nuked) {
    return flag.frozenPot;
  }
  const elapsed = Math.max(0, nowMs - flag.createdAtMs);
  return flag.frozenPot + Math.floor(elapsed / FLAG_POT_INTERVAL_MS);
}

/** Credit full 5s intervals into frozenPot; preserve partial-interval remainder. */
export function materializePot(flag: FlagState, nowMs: number): void {
  if (flag.nuked) {
    return;
  }
  const elapsed = Math.max(0, nowMs - flag.createdAtMs);
  const increments = Math.floor(elapsed / FLAG_POT_INTERVAL_MS);
  if (increments === 0) {
    return;
  }
  flag.frozenPot += increments;
  flag.createdAtMs += increments * FLAG_POT_INTERVAL_MS;
}

export function materializePots(flags: FlagState[], nowMs: number): void {
  for (const flag of flags) {
    materializePot(flag, nowMs);
  }
}

function isInBounds(
  x: number,
  y: number,
  bounds: GridBounds,
): boolean {
  return (
    x >= bounds.min_x &&
    x <= bounds.max_x &&
    y >= bounds.min_y &&
    y <= bounds.max_y
  );
}

function shuffleInPlace<T>(items: T[], random: () => number): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const tmp = items[i]!;
    items[i] = items[j]!;
    items[j] = tmp;
  }
}

export function enumerateRingCandidates(
  grid: Grid,
  oldBounds: GridBounds,
): Array<{ x: number; y: number }> {
  const candidates: Array<{ x: number; y: number }> = [];
  grid.forEachCell((x, y, owner, nuked) => {
    if (isInBounds(x, y, oldBounds)) {
      return;
    }
    if (owner !== 0 || nuked) {
      return;
    }
    candidates.push({ x, y });
  });
  return candidates;
}

export function spawnFlagsInRing(
  grid: Grid,
  oldBounds: GridBounds,
  currentFlags: FlagState[],
  newSize: number,
  nowMs: number,
  random: () => number = Math.random,
): FlagState[] {
  const target = targetFlagCount(newSize);
  const toSpawn = Math.max(0, target - currentFlags.length);
  if (toSpawn === 0) {
    return [];
  }

  const candidates = enumerateRingCandidates(grid, oldBounds);
  shuffleInPlace(candidates, random);
  const picked = candidates.slice(0, toSpawn);
  return picked.map((cell) => createFlag(cell.x, cell.y, nowMs));
}
