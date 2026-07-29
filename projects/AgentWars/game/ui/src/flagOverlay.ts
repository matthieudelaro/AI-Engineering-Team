import type { FlagInfo } from "./types.js";

/** Cell key used by the board (`x,y`). */
export function flagCellKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** Active (non-nuked) flag coordinates from a cached GetFlags payload. */
export function activeFlagKeys(flags: readonly FlagInfo[]): Set<string> {
  const keys = new Set<string>();
  for (const flag of flags) {
    if (flag.nuked) {
      continue;
    }
    keys.add(flagCellKey(flag.x, flag.y));
  }
  return keys;
}

export function cellHasActiveFlag(
  x: number,
  y: number,
  tileHasFlag: boolean,
  activeFlags: ReadonlySet<string>,
): boolean {
  return tileHasFlag || activeFlags.has(flagCellKey(x, y));
}

/**
 * Ensure flag-only (fog) cells are included in the paint list so markers draw
 * even when the map tile stream never returned that cell.
 */
export function mergeFlagCoordsIntoRender(
  coords: ReadonlyArray<{ x: number; y: number }>,
  activeFlags: ReadonlySet<string>,
): Array<{ x: number; y: number }> {
  const seen = new Set<string>();
  const merged: Array<{ x: number; y: number }> = [];

  for (const cell of coords) {
    const key = flagCellKey(cell.x, cell.y);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push({ x: cell.x, y: cell.y });
  }

  for (const key of activeFlags) {
    if (seen.has(key)) {
      continue;
    }
    const [xs, ys] = key.split(",");
    const x = Number.parseInt(xs!, 10);
    const y = Number.parseInt(ys!, 10);
    if (Number.isNaN(x) || Number.isNaN(y)) {
      continue;
    }
    seen.add(key);
    merged.push({ x, y });
  }

  return merged;
}
