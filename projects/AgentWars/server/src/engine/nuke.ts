import {
  NUKE_COST_MODEL,
  NUKE_EXPLOSION_MODEL,
} from "./constants.js";
import type { Grid } from "./grid.js";

export interface NukeResult {
  cost: number;
  radius: number;
  launchId: string;
  hit: Array<{ x: number; y: number }>;
}

export function computeNukeRadius(distance: number): number {
  const raw = Math.floor(
    NUKE_EXPLOSION_MODEL.base_radius_tiles -
      distance * NUKE_EXPLOSION_MODEL.distance_decay,
  );
  return Math.min(
    NUKE_EXPLOSION_MODEL.max_radius_tiles,
    Math.max(NUKE_EXPLOSION_MODEL.min_radius_tiles, raw),
  );
}

export function nearestOwnedChebyshevDistance(
  grid: Grid,
  playerId: number,
  targetX: number,
  targetY: number,
): number {
  if (grid.getOwner(targetX, targetY) === playerId) {
    return 0;
  }
  let minDistance = Number.POSITIVE_INFINITY;
  grid.forEachCell((x, y, owner) => {
    if (owner !== playerId) {
      return;
    }
    const distance = Math.max(Math.abs(x - targetX), Math.abs(y - targetY));
    if (distance < minDistance) {
      minDistance = distance;
    }
  });
  return minDistance;
}

function chebyshevDisk(
  x: number,
  y: number,
  radius: number,
): Array<{ x: number; y: number }> {
  const cells: Array<{ x: number; y: number }> = [];
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) > radius) {
        continue;
      }
      cells.push({ x: x + dx, y: y + dy });
    }
  }
  return cells;
}

/**
 * Mark in-bounds cells within effective Chebyshev radius as permanently nuked.
 * Cost equals newly nuked cells × cost_per_tile. Clears ownership on new hits.
 */
export function launchNuke(
  grid: Grid,
  playerId: number,
  x: number,
  y: number,
  launchId: string,
): NukeResult {
  const distance = nearestOwnedChebyshevDistance(grid, playerId, x, y);
  const radius = computeNukeRadius(distance);
  const hit: Array<{ x: number; y: number }> = [];
  let cost = 0;

  for (const cell of chebyshevDisk(x, y, radius)) {
    if (!grid.inBounds(cell.x, cell.y)) {
      continue;
    }
    const alreadyNuked = grid.isNuked(cell.x, cell.y);
    if (!alreadyNuked) {
      cost += NUKE_COST_MODEL.cost_per_tile;
      grid.setNuked(cell.x, cell.y, true);
      grid.setOwner(cell.x, cell.y, 0);
    }
    hit.push(cell);
  }

  return { cost, radius, launchId, hit };
}
