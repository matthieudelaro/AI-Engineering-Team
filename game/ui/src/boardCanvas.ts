import { computeFitTransform } from "./mapZoom.js";
import type { BoundBox } from "./types.js";

export const CELL_SIZE = 14;
export const CELL_GAP = 1;
export const CELL_STRIDE = CELL_SIZE + CELL_GAP;
export const EMPTY_FILL = "#1e2836";
export const BOARD_GAP_COLOR = "#2a3648";
export const SELF_OUTLINE = "#ffffff";
export const FLAG_GOLD = "#f5c842";
export const FLAG_POLE = "#fff8e7";
export const FLAG_POLE_SHADOW = "#b8860b";
/** Pending claim on an unknown/empty cell — must contrast with BOARD_GAP_COLOR. */
export const PENDING_EMPTY_FILL = "#5c8eb8";
export const PENDING_OUTLINE = "#ffe566";

const MAX_DEVICE_PIXEL_RATIO = 3;

export interface BoardCellState {
  fill: string;
  isSelf: boolean;
  hasFlag: boolean;
  isPending: boolean;
}

export interface Camera {
  scale: number;
  translateX: number;
  translateY: number;
}

/** Keep the same cells under the same screen pixels when bounds.min_* changes. */
export function compensateCameraForBoundsChange(
  previous: BoundBox,
  next: BoundBox,
  camera: Camera,
): Camera {
  const originShiftX = (previous.min_x - next.min_x) * CELL_STRIDE;
  const originShiftY = (previous.min_y - next.min_y) * CELL_STRIDE;
  return {
    scale: camera.scale,
    translateX: camera.translateX - originShiftX * camera.scale,
    translateY: camera.translateY - originShiftY * camera.scale,
  };
}

export function boardPixelSize(bounds: BoundBox): { width: number; height: number } {
  const cols = bounds.max_x - bounds.min_x + 1;
  const rows = bounds.max_y - bounds.min_y + 1;
  return {
    width: cols * CELL_SIZE + Math.max(0, cols - 1) * CELL_GAP,
    height: rows * CELL_SIZE + Math.max(0, rows - 1) * CELL_GAP,
  };
}

export function cellPixelOrigin(
  x: number,
  y: number,
  bounds: BoundBox,
): { px: number; py: number } {
  const col = x - bounds.min_x;
  const row = y - bounds.min_y;
  return {
    px: col * CELL_STRIDE,
    py: row * CELL_STRIDE,
  };
}

export function cellFromPoint(
  px: number,
  py: number,
  bounds: BoundBox,
): { x: number; y: number } | null {
  const { width, height } = boardPixelSize(bounds);
  if (px < 0 || py < 0 || px >= width || py >= height) {
    return null;
  }

  const col = Math.floor(px / CELL_STRIDE);
  const row = Math.floor(py / CELL_STRIDE);
  const localX = px - col * CELL_STRIDE;
  const localY = py - row * CELL_STRIDE;
  if (localX >= CELL_SIZE || localY >= CELL_SIZE) {
    return null;
  }

  const x = bounds.min_x + col;
  const y = bounds.min_y + row;
  if (x > bounds.max_x || y > bounds.max_y) {
    return null;
  }
  return { x, y };
}

/**
 * Like cellFromPoint, but maps inter-cell gap pixels to the nearest cell so
 * paint strokes over fog/empty areas still register.
 */
export function cellFromPointNearest(
  px: number,
  py: number,
  bounds: BoundBox,
): { x: number; y: number } | null {
  const exact = cellFromPoint(px, py, bounds);
  if (exact) {
    return exact;
  }

  const { width, height } = boardPixelSize(bounds);
  if (px < 0 || py < 0 || px >= width || py >= height) {
    return null;
  }

  const maxCol = bounds.max_x - bounds.min_x;
  const maxRow = bounds.max_y - bounds.min_y;
  const col = Math.min(maxCol, Math.max(0, Math.floor(px / CELL_STRIDE)));
  const row = Math.min(maxRow, Math.max(0, Math.floor(py / CELL_STRIDE)));
  return { x: bounds.min_x + col, y: bounds.min_y + row };
}

/** Pixel rect covering claimed cells, padded for a comfortable default view. */
export function claimedContentPixelRect(
  bounds: BoundBox,
  cells: ReadonlyArray<{ x: number; y: number }>,
  padCells = 12,
): { x: number; y: number; width: number; height: number } | null {
  if (cells.length === 0) {
    return null;
  }

  let minX = cells[0]!.x;
  let maxX = cells[0]!.x;
  let minY = cells[0]!.y;
  let maxY = cells[0]!.y;
  for (const cell of cells) {
    if (cell.x < minX) minX = cell.x;
    if (cell.x > maxX) maxX = cell.x;
    if (cell.y < minY) minY = cell.y;
    if (cell.y > maxY) maxY = cell.y;
  }

  const span = Math.max(maxX - minX, maxY - minY, 1);
  const pad = Math.max(padCells, Math.ceil(span * 0.08));
  minX = Math.max(bounds.min_x, minX - pad);
  maxX = Math.min(bounds.max_x, maxX + pad);
  minY = Math.max(bounds.min_y, minY - pad);
  maxY = Math.min(bounds.max_y, maxY + pad);

  const topLeft = cellPixelOrigin(minX, minY, bounds);
  const bottomRight = cellPixelOrigin(maxX, maxY, bounds);
  return {
    x: topLeft.px,
    y: topLeft.py,
    width: bottomRight.px + CELL_SIZE - topLeft.px,
    height: bottomRight.py + CELL_SIZE - topLeft.py,
  };
}

function brightenHex(hex: string, factor: number): string {
  const normalized = hex.replace("#", "");
  if (normalized.length !== 6) {
    return hex;
  }
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  const clamp = (value: number): number => Math.min(255, Math.max(0, Math.round(value)));
  const toHex = (value: number): string => value.toString(16).padStart(2, "0");
  return `#${toHex(clamp(r * factor))}${toHex(clamp(g * factor))}${toHex(clamp(b * factor))}`;
}

function drawFlagMarker(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  isSelf: boolean,
): void {
  // Self tiles already get a white outline in drawCell; others get a gold border.
  if (!isSelf) {
    ctx.strokeStyle = FLAG_GOLD;
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 1, py + 1, CELL_SIZE - 2, CELL_SIZE - 2);
  }

  const pole = ctx.createLinearGradient(px + 3, py + 2, px + 3, py + 12);
  pole.addColorStop(0, FLAG_POLE);
  pole.addColorStop(1, FLAG_POLE_SHADOW);
  ctx.fillStyle = pole;
  ctx.fillRect(px + 3, py + 2, 2, 10);

  ctx.fillStyle = FLAG_GOLD;
  ctx.beginPath();
  ctx.moveTo(px + 5, py + 2);
  ctx.lineTo(px + 12, py + 5);
  ctx.lineTo(px + 5, py + 8);
  ctx.closePath();
  ctx.fill();
}

export function drawCell(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  state: BoardCellState,
): void {
  const isEmptyBase = state.fill === EMPTY_FILL;
  let fill = state.fill;
  if (state.isPending) {
    // Brightening empty/unknown toward gap color makes pending invisible; use a
    // dedicated fill so fog / unexplored claims still show feedback.
    fill = isEmptyBase ? PENDING_EMPTY_FILL : brightenHex(state.fill, 1.35);
  }
  ctx.fillStyle = fill;
  ctx.fillRect(px, py, CELL_SIZE, CELL_SIZE);

  if (state.isSelf) {
    ctx.strokeStyle = SELF_OUTLINE;
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 1, py + 1, CELL_SIZE - 2, CELL_SIZE - 2);
  }

  if (state.isPending) {
    ctx.strokeStyle = PENDING_OUTLINE;
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 1, py + 1, CELL_SIZE - 2, CELL_SIZE - 2);
  }

  if (state.hasFlag) {
    drawFlagMarker(ctx, px, py, state.isSelf);
  }
}

export class BoardRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private bounds: BoundBox | null = null;
  private camera: Camera = { scale: 1, translateX: 0, translateY: 0 };
  private viewportCssWidth = 0;
  private viewportCssHeight = 0;
  private devicePixelRatio = 1;
  private cellState: ((x: number, y: number) => BoardCellState) | null = null;
  private coords: Array<{ x: number; y: number }> = [];
  private cellOverrides = new Map<string, BoardCellState>();
  private redrawScheduled = false;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("2d canvas context unavailable");
    }
    this.canvas = canvas;
    this.ctx = ctx;
  }

  getBounds(): BoundBox | null {
    return this.bounds ? { ...this.bounds } : null;
  }

  getCamera(): Camera {
    return { ...this.camera };
  }

  setCamera(camera: Camera): void {
    this.camera = { ...camera };
    this.scheduleRedraw();
  }

  setViewportCssSize(width: number, height: number): void {
    if (width <= 0 || height <= 0) {
      return;
    }
    const dpr = Math.min(
      typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
      MAX_DEVICE_PIXEL_RATIO,
    );
    const sizeChanged =
      this.viewportCssWidth !== width ||
      this.viewportCssHeight !== height ||
      this.devicePixelRatio !== dpr;
    if (!sizeChanged) {
      return;
    }
    this.viewportCssWidth = width;
    this.viewportCssHeight = height;
    this.devicePixelRatio = dpr;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    if (this.bounds && this.cellState) {
      this.redrawScheduled = false;
      this.drawFrame();
    } else {
      this.scheduleRedraw();
    }
  }

  fitWorldSize(): { width: number; height: number } {
    if (!this.bounds) {
      return { width: 0, height: 0 };
    }
    return boardPixelSize(this.bounds);
  }

  containsCell(x: number, y: number): boolean {
    if (!this.bounds) {
      return false;
    }
    return (
      x >= this.bounds.min_x &&
      x <= this.bounds.max_x &&
      y >= this.bounds.min_y &&
      y <= this.bounds.max_y
    );
  }

  renderFull(
    bounds: BoundBox,
    cellState: (x: number, y: number) => BoardCellState,
    coords: Iterable<{ x: number; y: number }>,
  ): void {
    this.bounds = { ...bounds };
    this.cellState = cellState;
    this.coords = [...coords];
    this.cellOverrides.clear();
    this.scheduleRedraw();
  }

  paintCell(x: number, y: number, state: BoardCellState): void {
    if (!this.bounds || !this.containsCell(x, y)) {
      return;
    }
    const key = `${x},${y}`;
    if (!this.coords.some((c) => `${c.x},${c.y}` === key)) {
      this.coords.push({ x, y });
    }
    this.cellOverrides.set(key, state);
    this.scheduleRedraw();
  }

  hitTest(cssX: number, cssY: number): { x: number; y: number } | null {
    if (!this.bounds || this.viewportCssWidth <= 0 || this.viewportCssHeight <= 0) {
      return null;
    }
    const { scale, translateX, translateY } = this.camera;
    if (scale <= 0) {
      return null;
    }
    const worldX = (cssX - translateX) / scale;
    const worldY = (cssY - translateY) / scale;
    return cellFromPointNearest(worldX, worldY, this.bounds);
  }

  private scheduleRedraw(): void {
    if (this.redrawScheduled || !this.bounds || !this.cellState) {
      return;
    }
    this.redrawScheduled = true;
    const schedule =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame
        : (callback: () => void) => {
            callback();
          };
    schedule(() => {
      this.redrawScheduled = false;
      this.drawFrame();
    });
  }

  private drawFrame(): void {
    if (!this.bounds || !this.cellState) {
      return;
    }
    if (this.viewportCssWidth <= 0 || this.viewportCssHeight <= 0) {
      return;
    }

    const { width, height } = boardPixelSize(this.bounds);

    // If we never fitted, scale=1 shows only the top-left of a multi-thousand-px
    // world (looks empty). Auto-fit so the first paint is usable.
    if (
      this.camera.scale === 1 &&
      this.camera.translateX === 0 &&
      this.camera.translateY === 0 &&
      width > this.viewportCssWidth
    ) {
      const fit = computeFitTransform(
        this.viewportCssWidth,
        this.viewportCssHeight,
        width,
        height,
      );
      this.camera = {
        scale: fit.scale,
        translateX: fit.translateX,
        translateY: fit.translateY,
      };
    }

    const dpr = this.devicePixelRatio;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const { scale, translateX, translateY } = this.camera;
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, translateX * dpr, translateY * dpr);

    ctx.fillStyle = BOARD_GAP_COLOR;
    ctx.fillRect(0, 0, width, height);

    for (const { x, y } of this.coords) {
      if (!this.containsCell(x, y)) {
        continue;
      }
      const { px, py } = cellPixelOrigin(x, y, this.bounds);
      const key = `${x},${y}`;
      const state = this.cellOverrides.get(key) ?? this.cellState(x, y);
      drawCell(ctx, px, py, state);
    }
  }
}
