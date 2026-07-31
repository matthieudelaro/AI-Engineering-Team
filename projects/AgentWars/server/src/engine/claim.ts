import { EMPTY, type RejectionReason } from "./constants.js";
import type { Grid } from "./grid.js";

export type ClaimResult =
  | { ok: true }
  | { ok: false; reason: RejectionReason };

/**
 * Place-tile rules: any empty or enemy cell in bounds is claimable.
 * Adjacency to owned land is NOT required. Rejects nuked and own tiles.
 */
export function tryClaim(
  grid: Grid,
  playerId: number,
  x: number,
  y: number,
): ClaimResult {
  if (!grid.inBounds(x, y)) {
    return { ok: false, reason: "OUT_OF_BOUNDS" };
  }

  if (grid.isNuked(x, y)) {
    return { ok: false, reason: "INVALID_TARGET" };
  }

  const owner = grid.getOwner(x, y);
  if (owner === playerId) {
    return { ok: false, reason: "INVALID_TARGET" };
  }

  grid.setOwner(x, y, playerId);
  return { ok: true };
}

export function countOwnedTiles(grid: Grid, playerId: number): number {
  return grid.playerTileCount(playerId);
}

export { EMPTY };
