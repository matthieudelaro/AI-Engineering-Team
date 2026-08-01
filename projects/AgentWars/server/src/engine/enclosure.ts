import {
  ALLOW_MAP_EDGE_AS_WALL,
  EMPTY,
  ORTHOGONAL_DELTAS,
} from "./constants.js";
import type { Grid } from "./grid.js";

export interface Cell {
  x: number;
  y: number;
}

export interface CaptureResult {
  capturer: number;
  victim: number;
  cells: Cell[];
}

const MAX_LASSO_GENERATIONS = 8;

/**
 * After any claim, resolve all sealed mono-victim components on the board.
 * Runs for every possible capturer (not only the player who just claimed), so
 * a tile placed inside an enemy ring is captured immediately.
 */
export function applyCaptures(
  grid: Grid,
  _claimingPlayerId: number,
  _claimedX: number,
  _claimedY: number,
): CaptureResult[] {
  return stabilizeLassos(grid);
}

/** @deprecated Prefer applyCaptures; kept for call-site clarity. */
export function findCapturesAfterClaim(
  grid: Grid,
  claimingPlayerId: number,
  claimedX: number,
  claimedY: number,
): CaptureResult[] {
  return applyCaptures(grid, claimingPlayerId, claimedX, claimedY);
}

function stabilizeLassos(grid: Grid): CaptureResult[] {
  const history: CaptureResult[] = [];

  for (let generation = 0; generation < MAX_LASSO_GENERATIONS; generation++) {
    const found = findAllLassos(grid);
    const captures = resolveCaptureConflicts(found);
    if (captures.length === 0) {
      break;
    }

    for (const capture of captures) {
      for (const cell of capture.cells) {
        if (
          grid.getOwner(cell.x, cell.y) === capture.victim &&
          !grid.isNuked(cell.x, cell.y)
        ) {
          grid.setOwner(cell.x, cell.y, capture.capturer);
        }
      }
      history.push(capture);
    }
  }

  return history;
}

/**
 * Detect all lassos without mutating ownership.
 * A victim component is captured when its orthogonal boundary contains only
 * the capturer / nuked / map edge (no empty gaps, no second opposing player).
 */
export function findAllLassos(grid: Grid): CaptureResult[] {
  const captures: CaptureResult[] = [];
  const visited = new Set<string>();
  const bounds = grid.bounds();

  for (let y = bounds.min_y; y <= bounds.max_y; y++) {
    for (let x = bounds.min_x; x <= bounds.max_x; x++) {
      if (grid.isNuked(x, y)) {
        continue;
      }
      const victim = grid.getOwner(x, y);
      if (victim === EMPTY) {
        continue;
      }
      const key = cellKey(x, y);
      if (visited.has(key)) {
        continue;
      }

      const component = collectVictimComponent(grid, victim, x, y, visited);
      if (component.length === 0) {
        continue;
      }

      const capturer = capturerIfSealed(grid, victim, component);
      if (capturer === null) {
        continue;
      }

      captures.push({ capturer, victim, cells: component });
    }
  }

  return captures;
}

function capturerIfSealed(
  grid: Grid,
  victim: number,
  component: Cell[],
): number | null {
  const componentSet = new Set(component.map((c) => cellKey(c.x, c.y)));
  let capturer: number | null = null;

  for (const cell of component) {
    for (const { dx, dy } of ORTHOGONAL_DELTAS) {
      const nx = cell.x + dx;
      const ny = cell.y + dy;
      const nKey = cellKey(nx, ny);

      if (componentSet.has(nKey)) {
        continue;
      }

      if (!grid.inBounds(nx, ny)) {
        if (!ALLOW_MAP_EDGE_AS_WALL) {
          return null;
        }
        continue;
      }

      if (grid.isNuked(nx, ny)) {
        continue;
      }

      const neighborOwner = grid.getOwner(nx, ny);
      if (neighborOwner === EMPTY) {
        return null;
      }
      if (neighborOwner === victim) {
        continue;
      }
      if (capturer === null) {
        capturer = neighborOwner;
      } else if (neighborOwner !== capturer) {
        return null;
      }
    }
  }

  return capturer;
}

function resolveCaptureConflicts(captures: CaptureResult[]): CaptureResult[] {
  const tileToCapturers = new Map<string, Set<number>>();

  for (const capture of captures) {
    for (const cell of capture.cells) {
      const key = cellKey(cell.x, cell.y);
      let set = tileToCapturers.get(key);
      if (!set) {
        set = new Set();
        tileToCapturers.set(key, set);
      }
      set.add(capture.capturer);
    }
  }

  return captures.filter((capture) =>
    capture.cells.every(
      (cell) => (tileToCapturers.get(cellKey(cell.x, cell.y))?.size ?? 0) <= 1,
    ),
  );
}

function collectVictimComponent(
  grid: Grid,
  victim: number,
  startX: number,
  startY: number,
  globalVisited: Set<string>,
): Cell[] {
  const component: Cell[] = [];
  const queue: Cell[] = [{ x: startX, y: startY }];
  const localVisited = new Set<string>();

  while (queue.length > 0) {
    const cell = queue.shift()!;
    const key = cellKey(cell.x, cell.y);
    if (localVisited.has(key)) {
      continue;
    }
    if (!grid.inBounds(cell.x, cell.y)) {
      continue;
    }
    if (grid.getOwner(cell.x, cell.y) !== victim || grid.isNuked(cell.x, cell.y)) {
      continue;
    }

    localVisited.add(key);
    globalVisited.add(key);
    component.push(cell);

    for (const { dx, dy } of ORTHOGONAL_DELTAS) {
      queue.push({ x: cell.x + dx, y: cell.y + dy });
    }
  }

  return component;
}

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}
