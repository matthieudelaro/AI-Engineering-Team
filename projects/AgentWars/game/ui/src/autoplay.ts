import type { BoundBox } from "./types.js";
import { pickGrowCell } from "./growTiles.js";
import { pickBridgeCell, type Point } from "./joinTiles.js";

export interface AutoplayOptions {
  getBounds: () => BoundBox | null;
  getOwnedTiles: () => Point[];
  getRecentClaims: () => Point[];
  isOwned: (x: number, y: number) => boolean;
  getAvailableSlots: () => number;
  onClaim: (x: number, y: number) => boolean;
}

const RANDOM_RATIO = 0.05;
const GROW_RATIO = 0.4;

type Strategy = "random" | "grow" | "bridge";

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

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

function pickRandomCell(
  bounds: BoundBox,
  isOwned: (x: number, y: number) => boolean,
): Point | null {
  for (let attempt = 0; attempt < 12; attempt++) {
    const x = randomInt(bounds.min_x, bounds.max_x);
    const y = randomInt(bounds.min_y, bounds.max_y);
    if (!isOwned(x, y)) {
      return { x, y };
    }
  }
  return null;
}

function pickForStrategy(
  strategy: Strategy,
  options: AutoplayOptions,
  bounds: BoundBox,
): Point | null {
  switch (strategy) {
    case "random":
      return pickRandomCell(bounds, options.isOwned);
    case "grow":
      return pickGrowCell(options.getRecentClaims(), options.isOwned, bounds);
    case "bridge":
      return pickBridgeCell(options.getOwnedTiles(), options.isOwned);
  }
}

const FALLBACK_ORDER: Record<Strategy, Strategy[]> = {
  random: ["grow", "bridge", "random"],
  grow: ["bridge", "random", "grow"],
  bridge: ["grow", "random", "bridge"],
};

function pickTarget(options: AutoplayOptions, bounds: BoundBox): Point | null {
  const primary = pickStrategy();
  const tried = new Set<Strategy>();

  for (const strategy of [primary, ...FALLBACK_ORDER[primary]]) {
    if (tried.has(strategy)) {
      continue;
    }
    tried.add(strategy);
    const target = pickForStrategy(strategy, options, bounds);
    if (target !== null) {
      return target;
    }
  }

  return null;
}

export function startAutoplay(options: AutoplayOptions): () => void {
  const tick = (): void => {
    const bounds = options.getBounds();
    if (bounds === null) {
      return;
    }

    let slots = options.getAvailableSlots();
    while (slots > 0) {
      const target = pickTarget(options, bounds);
      if (target === null) {
        break;
      }
      if (!options.onClaim(target.x, target.y)) {
        break;
      }
      slots = options.getAvailableSlots();
    }
  };

  const id = setInterval(tick, 25);
  return () => clearInterval(id);
}
