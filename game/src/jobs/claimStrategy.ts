import {
  blockedClaimCells,
  buildOwnershipMap,
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
const GROW_RATIO = 0.85;
/** Skip expensive bridge when we own more than this many visible tiles. */
const BRIDGE_OWNED_CAP = 600;

function key(x: number, y: number): string {
  return `${x},${y}`;
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
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
  owned: Set<string>,
  blocked: Set<string>,
): Point | null {
  return pickGrowCell(map, owned, blocked, []);
}

function growFromAnchors(
  owned: Set<string>,
  blocked: Set<string>,
  anchors: Point[],
  bounds: MapResponse["bounds"],
): Point | null {
  const candidates: Point[] = [];
  const seen = new Set<string>();

  for (const anchor of anchors) {
    if (!owned.has(key(anchor.x, anchor.y))) {
      continue;
    }
    for (const { x: dx, y: dy } of NEIGHBORS) {
      const x = anchor.x + dx;
      const y = anchor.y + dy;
      const k = key(x, y);
      if (seen.has(k) || blocked.has(k) || !inBounds(x, y, bounds)) {
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

function pickGrowCell(
  map: MapResponse,
  owned: Set<string>,
  blocked: Set<string>,
  recentClaims: Point[],
): Point | null {
  const fromRecent = growFromAnchors(owned, blocked, recentClaims, map.bounds);
  if (fromRecent) {
    return fromRecent;
  }

  if (owned.size === 0) {
    return null;
  }
  const ownedList = [...owned];
  const sampleSize = Math.min(48, ownedList.length);
  const anchors: Point[] = [];
  for (let i = 0; i < sampleSize; i++) {
    const k = ownedList[Math.floor(Math.random() * ownedList.length)]!;
    const [xs, ys] = k.split(",");
    anchors.push({ x: Number(xs), y: Number(ys) });
  }
  return growFromAnchors(owned, blocked, anchors, map.bounds);
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
  owned: Set<string>,
  blocked: Set<string>,
): Point | null {
  if (owned.size < 2 || owned.size > BRIDGE_OWNED_CAP) {
    return null;
  }

  const tiles: Point[] = [];
  for (const k of owned) {
    const [xs, ys] = k.split(",");
    tiles.push({ x: Number(xs), y: Number(ys) });
  }

  const components = findConnectedComponents(tiles);
  if (components.length < 2) {
    return null;
  }

  const sorted = [...components].sort((a, b) => a.length - b.length);
  let bestPair: { a: Point; b: Point } | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  const maxComponents = Math.min(sorted.length, 8);
  for (let i = 0; i < maxComponents; i++) {
    for (let j = i + 1; j < maxComponents; j++) {
      const ca = sorted[i]!;
      const cb = sorted[j]!;
      for (const a of ca) {
        for (const b of cb) {
          const score = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
          if (score < bestScore) {
            bestScore = score;
            bestPair = { a, b };
          }
        }
      }
    }
  }

  if (!bestPair || bestScore <= 1) {
    return null;
  }

  const line = lineBetween(bestPair.a, bestPair.b);
  for (const p of line) {
    const k = key(p.x, p.y);
    if (blocked.has(k) || !inBounds(p.x, p.y, map.bounds)) {
      continue;
    }
    // Only the next orthogonal step from owned land is claimable; mid-line
    // empties return INVALID_TARGET and burn the place-tile budget.
    let adjacent = false;
    for (const { x: dx, y: dy } of NEIGHBORS) {
      if (owned.has(key(p.x + dx, p.y + dy))) {
        adjacent = true;
        break;
      }
    }
    if (adjacent) {
      return p;
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
  owned: Set<string>,
  blocked: Set<string>,
  recentClaims: Point[],
): Point | null {
  switch (strategy) {
    case "random":
      return pickRandomCell(map, owned, blocked);
    case "grow":
      return pickGrowCell(map, owned, blocked, recentClaims);
    case "bridge":
      return pickBridgeCell(map, owned, blocked);
  }
}

const FALLBACK_ORDER: Record<Strategy, Strategy[]> = {
  random: ["grow", "bridge", "random"],
  grow: ["bridge", "random", "grow"],
  bridge: ["grow", "random", "bridge"],
};

/** 5% random · 85% grow · 10% bridge (bridge skipped when territory is huge). */
export function pickClaimTarget(
  map: MapResponse,
  self: SelfContext,
  recentClaims: Point[],
  ownedSet?: Set<string>,
  pendingSet?: Set<string>,
): Point | null {
  const { owned: ownedFromMap, occupied } = buildOwnershipMap(map.tiles, self.name);
  const owned = ownedSet ?? ownedFromMap;
  const blocked = blockedClaimCells(owned, pendingSet, occupied, self.name);
  const primary = pickStrategy();
  const tried = new Set<Strategy>();

  for (const strategy of [primary, ...FALLBACK_ORDER[primary]]) {
    if (tried.has(strategy)) {
      continue;
    }
    tried.add(strategy);
    const target = pickForStrategy(strategy, map, owned, blocked, recentClaims);
    if (target !== null) {
      return target;
    }
  }

  if (owned.size === 0 && self.tileCount === 0) {
    const cx = Math.floor((map.bounds.min_x + map.bounds.max_x) / 2);
    const cy = Math.floor((map.bounds.min_y + map.bounds.max_y) / 2);
    const k = key(cx, cy);
    if (!blocked.has(k)) {
      return { x: cx, y: cy };
    }
  }

  // Stale map can still show enclosed "owned" cells after we lost them
  // (leaderboard tile_count is 0). Re-seed so we are not permanently idle.
  if (self.tileCount === 0) {
    const cx = Math.floor((map.bounds.min_x + map.bounds.max_x) / 2);
    const cy = Math.floor((map.bounds.min_y + map.bounds.max_y) / 2);
    const k = key(cx, cy);
    if (!blocked.has(k) && !owned.has(k)) {
      return { x: cx, y: cy };
    }
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const x = randomInt(map.bounds.min_x, map.bounds.max_x);
      const y = randomInt(map.bounds.min_y, map.bounds.max_y);
      const cell = key(x, y);
      if (!blocked.has(cell) && !owned.has(cell)) {
        return { x, y };
      }
    }
  }

  return null;
}
