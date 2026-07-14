export interface Point {
  x: number;
  y: number;
}

/** Manhattan-radius for ~25 cells (|dx| + |dy| <= radius). */
export const SHIFT_CLAIM_DIAMOND_RADIUS = 3;

/** Brush radii: Shift < A < S < D, each step doubles the previous. */
export const BRUSH_RADIUS_SHIFT = SHIFT_CLAIM_DIAMOND_RADIUS;
export const BRUSH_RADIUS_A = BRUSH_RADIUS_SHIFT * 2;
export const BRUSH_RADIUS_S = BRUSH_RADIUS_A * 2;
export const BRUSH_RADIUS_D = BRUSH_RADIUS_S * 2;

export interface BrushModifiers {
  shift: boolean;
  a: boolean;
  s: boolean;
  d: boolean;
}

/**
 * Brush Manhattan radius from modifiers. D > S > A > Shift; none → 0 (single cell).
 */
export function brushRadiusFromModifiers(mods: BrushModifiers): number {
  if (mods.d) {
    return BRUSH_RADIUS_D;
  }
  if (mods.s) {
    return BRUSH_RADIUS_S;
  }
  if (mods.a) {
    return BRUSH_RADIUS_A;
  }
  if (mods.shift) {
    return BRUSH_RADIUS_SHIFT;
  }
  return 0;
}

/** Cells in a diamond (losange) around (cx, cy), center first then rings outward. */
export function diamondCells(
  cx: number,
  cy: number,
  radius = SHIFT_CLAIM_DIAMOND_RADIUS,
): Point[] {
  const cells: Point[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    const dxLimit = radius - Math.abs(dy);
    for (let dx = -dxLimit; dx <= dxLimit; dx++) {
      cells.push({ x: cx + dx, y: cy + dy });
    }
  }
  cells.sort((a, b) => {
    const da = Math.abs(a.x - cx) + Math.abs(a.y - cy);
    const db = Math.abs(b.x - cx) + Math.abs(b.y - cy);
    if (da !== db) {
      return da - db;
    }
    if (a.y !== b.y) {
      return a.y - b.y;
    }
    return a.x - b.x;
  });
  return cells;
}

/** Inclusive grid line from a to b (Bresenham). Always includes both endpoints. */
export function lineCells(a: Point, b: Point): Point[] {
  const cells: Point[] = [];
  let x0 = a.x;
  let y0 = a.y;
  const x1 = b.x;
  const y1 = b.y;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  while (true) {
    cells.push({ x: x0, y: y0 });
    if (x0 === x1 && y0 === y1) {
      break;
    }
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
  return cells;
}
