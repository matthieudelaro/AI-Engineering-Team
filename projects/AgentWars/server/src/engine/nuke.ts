import type { Grid } from "./grid.js";

export const DEFAULT_NUKE_RADIUS = 3;

export interface NukeResult {
  cost: number;
  hit: Array<{ x: number; y: number }>;
}

/**
 * Mark all cells within Chebyshev radius as permanently nuked.
 * Cost equals the number of cells affected.
 */
export function launchNuke(
  grid: Grid,
  x: number,
  y: number,
  radius = DEFAULT_NUKE_RADIUS,
): NukeResult {
  const hit: Array<{ x: number; y: number }> = [];

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) > radius) {
        continue;
      }
      const tx = x + dx;
      const ty = y + dy;
      if (!grid.inBounds(tx, ty)) {
        continue;
      }
      grid.setNuked(tx, ty, true);
      hit.push({ x: tx, y: ty });
    }
  }

  return { cost: hit.length, hit };
}
