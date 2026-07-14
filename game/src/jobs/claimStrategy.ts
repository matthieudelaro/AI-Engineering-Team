import {
  buildOwnershipMap,
  ownerName,
  type MapResponse,
  type SelfContext,
} from "./shared.js";

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

const RANDOM_RATIO = 0.05;
const GROW_RATIO = 0.4;

function key(x: number, y: number): string {
  return `${x},${y}`;
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function ownedTiles(map: MapResponse, selfName: string | null): Point[] {
  const tiles: Point[] = [];
  for (const tile of map.tiles) {
    if (ownerName(tile.ownership) === selfName) {
      tiles.push({ x: tile.x, y: tile.y });
    }
  }
  return tiles;
}

function isOwned(
  map: MapResponse,
  selfName: string | null,
  x: number,
  y: number,
): boolean {
  const tile = map.tiles.find((t) => t.x === x && t.y === y);
  if (!tile) {
    return false;
  }
  return ownerName(tile.ownership) === selfName;
}

function inBounds(x: number, y: number, bounds: MapResponse["bounds"]): boolean {
  return (
    x >= bounds.min_x &&
    x <= bounds.max_x &&
    y >= bounds.min_y &&
    y <= bounds.max_y
  );
}

function pickRandomCell(
  map: MapResponse,
  selfName: string | null,
): Point | null {
  const { bounds } = map;
  for (let attempt = 0; attempt < 12; attempt++) {
    const x = randomInt(bounds.min_x, bounds.max_x);
    const y = randomInt(bounds.min_y, bounds.max_y);
    if (!isOwned(map, selfName, x, y)) {
      return { x, y };
    }
  }
  return null;
}

function pickGrowCell(
  map: MapResponse,
  selfName: string | null,
  recentClaims: Point[],
): Point | null {
  const candidates: Point[] = [];
  const seen = new Set<string>();

  for (const anchor of recentClaims) {
    if (!isOwned(map, selfName, anchor.x, anchor.y)) {
      continue;
    }
    for (const { x: dx, y: dy } of NEIGHBORS) {
      const x = anchor.x + dx;
      const y = anchor.y + dy;
      const k = key(x, y);
      if (
        seen.has(k) ||
        isOwned(map, selfName, x, y) ||
        !inBounds(x, y, map.bounds)
      ) {
        continue;
      }
      seen.add(k);
      candidates.push({ x, y });
    }
  }

  if (candidates.length === 0) {
    return null;
  }
  return candidates[Math.floor(Math.random() * candidates.length)]!;
}

function findConnectedComponents(tiles: Point[]): Point[][] {
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

function lineBetween(a: Point, b: Point): Point[] {
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

function pickBridgeCell(
  map: MapResponse,
  selfName: string | null,
): Point | null {
  const owned = ownedTiles(map, selfName);
  if (owned.length < 2) {
    return null;
  }

  const components = findConnectedComponents(owned);
  if (components.length < 2) {
    return null;
  }

  const sorted = [...components].sort((a, b) => a.length - b.length);
  let bestPair: { a: Point; b: Point } | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      let closest: { a: Point; b: Point; distSq: number } | null = null;
      for (const a of sorted[i]!) {
        for (const b of sorted[j]!) {
          const distSq = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
          if (closest === null || distSq < closest.distSq) {
            closest = { a, b, distSq };
          }
        }
      }
      if (closest === null) {
        continue;
      }
      const score = closest.distSq + sorted[i]!.length + sorted[j]!.length;
      if (score < bestScore) {
        bestScore = score;
        bestPair = { a: closest.a, b: closest.b };
      }
    }
  }

  if (bestPair === null) {
    return null;
  }

  for (const cell of lineBetween(bestPair.a, bestPair.b)) {
    if (!isOwned(map, selfName, cell.x, cell.y)) {
      return cell;
    }
  }

  return null;
}

type Strategy = "random" | "grow" | "bridge";

function pickStrategy(): Strategy {
  const r = Math.random();
  if (r < RANDOM_RATIO) {
    return "random";
  }
  if (r < RANDOM_RATIO + GROW_RATIO) {
    return "grow";
  }
  return "bridge";
}

function pickForStrategy(
  strategy: Strategy,
  map: MapResponse,
  self: SelfContext,
  recentClaims: Point[],
): Point | null {
  switch (strategy) {
    case "random":
      return pickRandomCell(map, self.name);
    case "grow":
      return pickGrowCell(map, self.name, recentClaims);
    case "bridge":
      return pickBridgeCell(map, self.name);
  }
}

const FALLBACK_ORDER: Record<Strategy, Strategy[]> = {
  random: ["grow", "bridge", "random"],
  grow: ["bridge", "random", "grow"],
  bridge: ["grow", "random", "bridge"],
};

/** 5% random · 40% grow from recent claims · 55% bridge lonely clusters. */
export function pickClaimTarget(
  map: MapResponse,
  self: SelfContext,
  recentClaims: Point[],
): Point | null {
  const primary = pickStrategy();
  const tried = new Set<Strategy>();

  for (const strategy of [primary, ...FALLBACK_ORDER[primary]]) {
    if (tried.has(strategy)) {
      continue;
    }
    tried.add(strategy);
    const target = pickForStrategy(strategy, map, self, recentClaims);
    if (target !== null) {
      return target;
    }
  }

  const { owned } = buildOwnershipMap(map.tiles, self.name);
  if (owned.size === 0 && self.tileCount === 0) {
    const cx = Math.floor((map.bounds.min_x + map.bounds.max_x) / 2);
    const cy = Math.floor((map.bounds.min_y + map.bounds.max_y) / 2);
    return { x: cx, y: cy };
  }

  return null;
}
