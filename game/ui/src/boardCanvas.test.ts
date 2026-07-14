import { describe, expect, it } from "vitest";
import {
  boardPixelSize,
  cellFromPoint,
  cellPixelOrigin,
  CELL_GAP,
  CELL_SIZE,
} from "./boardCanvas.js";

describe("boardPixelSize", () => {
  it("sizes a single cell without extra gap", () => {
    expect(boardPixelSize({ min_x: 0, min_y: 0, max_x: 0, max_y: 0 })).toEqual({
      width: CELL_SIZE,
      height: CELL_SIZE,
    });
  });

  it("adds a 1px gap between cells on each axis", () => {
    expect(boardPixelSize({ min_x: 0, min_y: 0, max_x: 1, max_y: 1 })).toEqual({
      width: CELL_SIZE * 2 + CELL_GAP,
      height: CELL_SIZE * 2 + CELL_GAP,
    });
  });

  it("works when bounds do not start at zero", () => {
    const size = boardPixelSize({ min_x: -2, min_y: 5, max_x: 0, max_y: 6 });
    expect(size).toEqual({
      width: CELL_SIZE * 3 + CELL_GAP * 2,
      height: CELL_SIZE * 2 + CELL_GAP,
    });
  });
});

describe("cellPixelOrigin", () => {
  it("maps world coordinates to canvas pixels", () => {
    const bounds = { min_x: 10, min_y: 20, max_x: 11, max_y: 21 };
    expect(cellPixelOrigin(10, 20, bounds)).toEqual({ px: 0, py: 0 });
    expect(cellPixelOrigin(11, 21, bounds)).toEqual({
      px: CELL_SIZE + CELL_GAP,
      py: CELL_SIZE + CELL_GAP,
    });
  });
});

describe("cellFromPoint", () => {
  const bounds = { min_x: 0, min_y: 0, max_x: 1, max_y: 1 };

  it("maps the top-left cell", () => {
    expect(cellFromPoint(0, 0, bounds)).toEqual({ x: 0, y: 0 });
    expect(cellFromPoint(CELL_SIZE - 1, CELL_SIZE - 1, bounds)).toEqual({ x: 0, y: 0 });
  });

  it("maps the second column and row past the gap", () => {
    expect(cellFromPoint(CELL_SIZE + CELL_GAP, 0, bounds)).toEqual({ x: 1, y: 0 });
    expect(cellFromPoint(0, CELL_SIZE + CELL_GAP, bounds)).toEqual({ x: 0, y: 1 });
  });

  it("returns null when the pointer is in the inter-cell gap", () => {
    expect(cellFromPoint(CELL_SIZE, 0, bounds)).toBeNull();
    expect(cellFromPoint(0, CELL_SIZE, bounds)).toBeNull();
  });

  it("returns null outside the board", () => {
    expect(cellFromPoint(-1, 0, bounds)).toBeNull();
    const { width, height } = boardPixelSize(bounds);
    expect(cellFromPoint(width, 0, bounds)).toBeNull();
    expect(cellFromPoint(0, height, bounds)).toBeNull();
  });

  it("respects non-zero bounds origins", () => {
    const shifted = { min_x: 5, min_y: 8, max_x: 6, max_y: 9 };
    expect(cellFromPoint(0, 0, shifted)).toEqual({ x: 5, y: 8 });
    expect(cellFromPoint(CELL_SIZE + CELL_GAP, CELL_SIZE + CELL_GAP, shifted)).toEqual({
      x: 6,
      y: 9,
    });
  });
});
