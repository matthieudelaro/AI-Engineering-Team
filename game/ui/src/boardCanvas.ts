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

export interface BoardCellState {
  fill: string;
  isSelf: boolean;
  hasFlag: boolean;
  isPending: boolean;
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
  const fill = state.isPending ? brightenHex(state.fill, 1.35) : state.fill;
  ctx.fillStyle = fill;
  ctx.fillRect(px, py, CELL_SIZE, CELL_SIZE);

  if (state.isSelf) {
    ctx.strokeStyle = SELF_OUTLINE;
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

  resize(bounds: BoundBox): void {
    const { width, height } = boardPixelSize(bounds);
    this.canvas.width = width;
    this.canvas.height = height;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.bounds = { ...bounds };
    this.ctx.fillStyle = BOARD_GAP_COLOR;
    this.ctx.fillRect(0, 0, width, height);
  }

  paintCell(x: number, y: number, state: BoardCellState): void {
    if (!this.bounds || !this.containsCell(x, y)) {
      return;
    }
    const { px, py } = cellPixelOrigin(x, y, this.bounds);
    drawCell(this.ctx, px, py, state);
  }

  renderFull(bounds: BoundBox, cellState: (x: number, y: number) => BoardCellState): void {
    const sizeChanged =
      this.bounds === null ||
      this.bounds.min_x !== bounds.min_x ||
      this.bounds.min_y !== bounds.min_y ||
      this.bounds.max_x !== bounds.max_x ||
      this.bounds.max_y !== bounds.max_y;
    if (sizeChanged) {
      this.resize(bounds);
    } else {
      const { width, height } = boardPixelSize(bounds);
      this.ctx.fillStyle = BOARD_GAP_COLOR;
      this.ctx.fillRect(0, 0, width, height);
    }

    for (let y = bounds.min_y; y <= bounds.max_y; y++) {
      for (let x = bounds.min_x; x <= bounds.max_x; x++) {
        this.paintCell(x, y, cellState(x, y));
      }
    }
  }
}
