import { FOG_PADDING } from "./constants.js";
import type { Grid, GridBounds } from "./grid.js";

export interface FogTile {
  x: number;
  y: number;
  owner: number;
  nuked: boolean;
}

export interface FogView {
  bounds: GridBounds;
  tiles: FogTile[];
}

export function getVisibleForPlayer(grid: Grid, playerId: number): FogView {
  const visible = new Set<string>();
  const ownedCells: Array<{ x: number; y: number }> = [];

  grid.forEachCell((x, y, owner) => {
    if (owner === playerId) {
      ownedCells.push({ x, y });
    }
  });

  for (const { x, y } of ownedCells) {
    for (let dy = -FOG_PADDING; dy <= FOG_PADDING; dy++) {
      for (let dx = -FOG_PADDING; dx <= FOG_PADDING; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) > FOG_PADDING) {
          continue;
        }
        const vx = x + dx;
        const vy = y + dy;
        if (grid.inBounds(vx, vy)) {
          visible.add(`${vx},${vy}`);
        }
      }
    }
  }

  const tiles: FogTile[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const key of visible) {
    const [xs, ys] = key.split(",");
    const x = Number(xs);
    const y = Number(ys);
    tiles.push({
      x,
      y,
      owner: grid.getOwner(x, y),
      nuked: grid.isNuked(x, y),
    });
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  if (tiles.length === 0) {
    return { bounds: grid.bounds(), tiles: [] };
  }

  return {
    bounds: { min_x: minX, min_y: minY, max_x: maxX, max_y: maxY },
    tiles,
  };
}
