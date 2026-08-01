import { EXPAND_THRESHOLD, SIZE_LADDER } from "./constants.js";
import type { Grid, GridBounds } from "./grid.js";

export interface ExpandResult {
  expanded: boolean;
  oldBounds?: GridBounds;
}

export function shouldExpand(grid: Grid): boolean {
  const total = grid.width * grid.height;
  return grid.claimedCount() / total >= EXPAND_THRESHOLD;
}

export function nextLadderSize(currentSize: number): number | null {
  const idx = SIZE_LADDER.indexOf(currentSize as (typeof SIZE_LADDER)[number]);
  if (idx === -1) {
    for (let i = 0; i < SIZE_LADDER.length - 1; i++) {
      if (currentSize < SIZE_LADDER[i]!) {
        return SIZE_LADDER[i]!;
      }
    }
    return currentSize < SIZE_LADDER.at(-1)! ? SIZE_LADDER.at(-1)! : null;
  }
  if (idx >= SIZE_LADDER.length - 1) {
    return null;
  }
  return SIZE_LADDER[idx + 1]!;
}

export function maybeExpand(grid: Grid): ExpandResult {
  if (!shouldExpand(grid)) {
    return { expanded: false };
  }
  const next = nextLadderSize(grid.width);
  if (next === null || next === grid.width) {
    return { expanded: false };
  }
  const oldBounds = grid.bounds();
  grid.resizeTo(next);
  return { expanded: true, oldBounds };
}
