export interface Point {
  x: number;
  y: number;
}

/** Manhattan-radius for ~25 cells (|dx| + |dy| <= radius). */
export const SHIFT_CLAIM_DIAMOND_RADIUS = 3;

/** Brush radii: Z < Shift < A < S < D; A/S/D each step doubles the previous. */
export const BRUSH_RADIUS_SHIFT = SHIFT_CLAIM_DIAMOND_RADIUS;
export const BRUSH_RADIUS_Z = Math.floor(BRUSH_RADIUS_SHIFT / 3);
export const BRUSH_RADIUS_A = BRUSH_RADIUS_SHIFT * 2;
export const BRUSH_RADIUS_S = BRUSH_RADIUS_A * 2;
export const BRUSH_RADIUS_D = BRUSH_RADIUS_S * 2;

/** Odd size of the F-key lasso bounding square (edge ring only). */
export const LASSO_SQUARE_SIZE = 5;

/** Half-extent from center to edge for LASSO_SQUARE_SIZE (floor((size-1)/2)). */
export const LASSO_HALF_EXTENT = (LASSO_SQUARE_SIZE - 1) / 2;

export interface BrushModifiers {
  shift: boolean;
  a: boolean;
  s: boolean;
  d: boolean;
  /** F-key edge lasso; when true, overrides diamond brushes. */
  f: boolean;
  z: boolean;
}

/**
 * Brush Manhattan radius from modifiers. D > S > A > Shift > Z; none → 0 (single cell).
 * Callers should check `mods.f` first and use `lassoEdgeCells` instead of a diamond.
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
  if (mods.z) {
    return BRUSH_RADIUS_Z;
  }
  return 0;
}

/**
 * Hollow axis-aligned square ring around (cx, cy). Interior is omitted so the
 * game can fill enclosed cells. Clockwise from top-left for contiguous edges.
 */
export function lassoEdgeCells(
  cx: number,
  cy: number,
  halfExtent = LASSO_HALF_EXTENT,
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
