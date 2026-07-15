import type { Point } from "./claimStrategy.js";

/**
 * Hollow-lasso geometry for auto-claim expansion.
 *
 * Mirrors the UI's `game/ui/src/claimDiamond.ts` math on purpose — jobs stay
 * independent of the Vite UI tree, so this is a deliberate duplicate rather than
 * a cross-tree import.
 */

/** Default half-extent from center to edge (matches the UI's 5×5 F-key lasso). */
export const DEFAULT_LASSO_HALF_EXTENT = 2;

/**
 * Hollow axis-aligned square ring around (cx, cy). The interior is omitted so
 * the game fills enclosed cells for us; edges are emitted clockwise from the
 * top-left corner so the perimeter stays contiguous.
 */
export function lassoEdgeCells(
  cx: number,
  cy: number,
  halfExtent = DEFAULT_LASSO_HALF_EXTENT,
): Point[] {
  const minX = cx - halfExtent;
  const maxX = cx + halfExtent;
  const minY = cy - halfExtent;
  const maxY = cy + halfExtent;
  const cells: Point[] = [];

  // Top edge left → right
  for (let x = minX; x <= maxX; x++) {
    cells.push({ x, y: minY });
  }
  // Right edge top+1 → bottom
  for (let y = minY + 1; y <= maxY; y++) {
    cells.push({ x: maxX, y });
  }
  // Bottom edge right-1 → left
  for (let x = maxX - 1; x >= minX; x--) {
    cells.push({ x, y: maxY });
  }
  // Left edge bottom-1 → top+1
  for (let y = maxY - 1; y > minY; y--) {
    cells.push({ x: minX, y });
  }

  return cells;
}
