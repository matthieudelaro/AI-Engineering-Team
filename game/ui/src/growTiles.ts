import type { BoundBox } from "./types.js";
import type { Point } from "./joinTiles.js";

const NEIGHBORS: Point[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

function key(x: number, y: number): string {
  return `${x},${y}`;
}

function inBounds(x: number, y: number, bounds: BoundBox): boolean {
  return (
    x >= bounds.min_x &&
    x <= bounds.max_x &&
    y >= bounds.min_y &&
    y <= bounds.max_y
  );
}

/** Claimable cells orthogonally adjacent to recent owned claims. */
export function pickGrowCell(
  recentClaims: Point[],
  isOwned: (x: number, y: number) => boolean,
  bounds: BoundBox,
): Point | null {
  const candidates: Point[] = [];
  const seen = new Set<string>();

  for (const anchor of recentClaims) {
    if (!isOwned(anchor.x, anchor.y)) {
      continue;
    }
    for (const { x: dx, y: dy } of NEIGHBORS) {
      const x = anchor.x + dx;
      const y = anchor.y + dy;
      const k = key(x, y);
      if (seen.has(k) || isOwned(x, y) || !inBounds(x, y, bounds)) {
        continue;
      }
      seen.add(k);
      candidates.push({ x, y });
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  const pick = candidates[Math.floor(Math.random() * candidates.length)]!;
  return pick;
}
