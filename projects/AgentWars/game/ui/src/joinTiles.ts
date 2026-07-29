export interface Point {
  x: number;
  y: number;
}

const NEIGHBORS: Point[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

function key(x: number, y: number): string {
  return `${x},${y}`;
}

export function findConnectedComponents(tiles: Point[]): Point[][] {
  const owned = new Set(tiles.map((t) => key(t.x, t.y)));
  const visited = new Set<string>();
  const components: Point[][] = [];

  for (const tile of tiles) {
    const start = key(tile.x, tile.y);
    if (visited.has(start)) {
      continue;
    }

    const component: Point[] = [];
    const queue = [tile];
    visited.add(start);

    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      for (const { x: dx, y: dy } of NEIGHBORS) {
        const nx = current.x + dx;
        const ny = current.y + dy;
        const k = key(nx, ny);
        if (owned.has(k) && !visited.has(k)) {
          visited.add(k);
          queue.push({ x: nx, y: ny });
        }
      }
    }

    components.push(component);
  }

  return components;
}

/** Integer line from (x0,y0) to (x1,y1), inclusive. */
export function lineBetween(a: Point, b: Point): Point[] {
  const points: Point[] = [];
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
    points.push({ x: x0, y: y0 });
    if (x0 === x1 && y0 === y1) {
      break;
    }
    const e2 = err * 2;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }

  return points;
}

function distanceSq(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function closestPairAcrossClusters(
  left: Point[],
  right: Point[],
): { a: Point; b: Point; distSq: number } | null {
  let best: { a: Point; b: Point; distSq: number } | null = null;
  for (const a of left) {
    for (const b of right) {
      const distSq = distanceSq(a, b);
      if (best === null || distSq < best.distSq) {
        best = { a, b, distSq };
      }
    }
  }
  return best;
}

/**
 * Pick a cell along the line between two nearby owned tiles in different
 * clusters — bridges isolated groups of our tiles.
 */
export function pickBridgeCell(
  ownedTiles: Point[],
  isOwned: (x: number, y: number) => boolean,
): Point | null {
  if (ownedTiles.length < 2) {
    return null;
  }

  const components = findConnectedComponents(ownedTiles);
  if (components.length < 2) {
    return null;
  }

  const sorted = [...components].sort((a, b) => a.length - b.length);

  let bestPair: { a: Point; b: Point } | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const pair = closestPairAcrossClusters(sorted[i]!, sorted[j]!);
      if (pair === null) {
        continue;
      }
      const lonelyBias = sorted[i]!.length + sorted[j]!.length;
      const score = pair.distSq + lonelyBias;
      if (score < bestScore) {
        bestScore = score;
        bestPair = { a: pair.a, b: pair.b };
      }
    }
  }

  if (bestPair === null) {
    return null;
  }

  const path = lineBetween(bestPair.a, bestPair.b);
  for (const cell of path) {
    if (!isOwned(cell.x, cell.y)) {
      return cell;
    }
  }

  return null;
}
