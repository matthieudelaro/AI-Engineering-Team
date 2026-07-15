import { describe, expect, it } from "vitest";
import {
  BOARD_GAP_COLOR,
  boardPixelSize,
  BoardRenderer,
  cellFromPoint,
  cellFromPointNearest,
  cellPixelOrigin,
  CELL_GAP,
  CELL_SIZE,
  CELL_STRIDE,
  compensateCameraForBoundsChange,
  EMPTY_FILL,
  PENDING_EMPTY_FILL,
} from "./boardCanvas.js";

describe("pending empty contrast", () => {
  it("uses a pending fill that is not the board gap color", () => {
    expect(PENDING_EMPTY_FILL.toLowerCase()).not.toBe(BOARD_GAP_COLOR.toLowerCase());
    expect(PENDING_EMPTY_FILL.toLowerCase()).not.toBe(EMPTY_FILL.toLowerCase());
  });
});

describe("cellFromPointNearest", () => {
  const bounds = { min_x: 0, min_y: 0, max_x: 1, max_y: 1 };

  it("matches cellFromPoint inside a cell", () => {
    expect(cellFromPointNearest(0, 0, bounds)).toEqual(cellFromPoint(0, 0, bounds));
  });

  it("snaps gap pixels to a neighboring cell instead of null", () => {
    expect(cellFromPoint(CELL_SIZE, 0, bounds)).toBeNull();
    expect(cellFromPointNearest(CELL_SIZE, 0, bounds)).toEqual({ x: 0, y: 0 });
  });
});

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

describe("compensateCameraForBoundsChange", () => {
  it("adjusts translate when min_x decreases", () => {
    const prev = { min_x: 10, min_y: 0, max_x: 20, max_y: 10 };
    const next = { min_x: 5, min_y: 0, max_x: 20, max_y: 10 };
    const camera = { scale: 2, translateX: 100, translateY: 50 };
    const originShiftX = (10 - 5) * CELL_STRIDE;
    expect(compensateCameraForBoundsChange(prev, next, camera)).toEqual({
      scale: 2,
      translateX: 100 - originShiftX * 2,
      translateY: 50,
    });
  });

  it("adjusts translate when min_y decreases", () => {
    const prev = { min_x: 0, min_y: 20, max_x: 10, max_y: 30 };
    const next = { min_x: 0, min_y: 15, max_x: 10, max_y: 30 };
    const camera = { scale: 1.5, translateX: 40, translateY: 80 };
    const originShiftY = (20 - 15) * CELL_STRIDE;
    expect(compensateCameraForBoundsChange(prev, next, camera)).toEqual({
      scale: 1.5,
      translateX: 40,
      translateY: 80 - originShiftY * 1.5,
    });
  });

  it("leaves camera unchanged when bounds origin is unchanged", () => {
    const prev = { min_x: 0, min_y: 0, max_x: 10, max_y: 10 };
    const next = { min_x: 0, min_y: 0, max_x: 20, max_y: 20 };
    const camera = { scale: 3, translateX: 12, translateY: 34 };
    expect(compensateCameraForBoundsChange(prev, next, camera)).toEqual(camera);
  });

  it("keeps the same screen position for a cell when bounds origin shifts", () => {
    const prev = { min_x: 10, min_y: 20, max_x: 30, max_y: 40 };
    const next = { min_x: 5, min_y: 15, max_x: 30, max_y: 40 };
    const camera = { scale: 1.5, translateX: 200, translateY: 100 };
    const cell = { x: 10, y: 20 };
    const beforePx = cellPixelOrigin(cell.x, cell.y, prev);
    const afterPx = cellPixelOrigin(cell.x, cell.y, next);
    const screenBefore = {
      x: camera.translateX + beforePx.px * camera.scale,
      y: camera.translateY + beforePx.py * camera.scale,
    };
    const compensated = compensateCameraForBoundsChange(prev, next, camera);
    const screenAfter = {
      x: compensated.translateX + afterPx.px * compensated.scale,
      y: compensated.translateY + afterPx.py * compensated.scale,
    };
    expect(screenAfter.x).toBeCloseTo(screenBefore.x);
    expect(screenAfter.y).toBeCloseTo(screenBefore.y);
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

describe("BoardRenderer", () => {
  const bounds = { min_x: 0, min_y: 0, max_x: 2, max_y: 2 };

  function makeCanvas(): HTMLCanvasElement {
    const ctx = {
      setTransform: () => {},
      clearRect: () => {},
      fillRect: () => {},
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 0,
      strokeRect: () => {},
      createLinearGradient: () => ({ addColorStop: () => {} }),
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      closePath: () => {},
      fill: () => {},
    } as unknown as CanvasRenderingContext2D;
    return {
      width: 0,
      height: 0,
      style: { width: "", height: "" },
      getContext: () => ctx,
    } as unknown as HTMLCanvasElement;
  }

  it("hit-tests through the camera transform", () => {
    const renderer = new BoardRenderer(makeCanvas());
    renderer.setViewportCssSize(400, 300);
    renderer.renderFull(
      bounds,
      () => ({ fill: "#000", isSelf: false, hasFlag: false, isPending: false }),
      [{ x: 1, y: 1 }],
    );
    const { width, height } = boardPixelSize(bounds);
    const fitScale = Math.min(400 / width, 300 / height);
    const translateX = (400 - width * fitScale) / 2;
    const translateY = (300 - height * fitScale) / 2;
    renderer.setCamera({ scale: fitScale, translateX, translateY });

    const origin = cellPixelOrigin(1, 1, bounds);
    const cssX = translateX + (origin.px + CELL_SIZE / 2) * fitScale;
    const cssY = translateY + (origin.py + CELL_SIZE / 2) * fitScale;
    expect(renderer.hitTest(cssX, cssY)).toEqual({ x: 1, y: 1 });
  });

  it("reports world size from bounds without sizing the canvas to it", () => {
    const canvas = makeCanvas();
    const renderer = new BoardRenderer(canvas);
    renderer.setViewportCssSize(100, 100);
    renderer.renderFull(
      bounds,
      () => ({ fill: "#000", isSelf: false, hasFlag: false, isPending: false }),
      [],
    );
    expect(renderer.fitWorldSize()).toEqual(boardPixelSize(bounds));
    expect(canvas.width).toBeLessThanOrEqual(300);
    expect(canvas.height).toBeLessThanOrEqual(300);
  });

  it("redraws synchronously when the viewport resizes after a full render", () => {
    let rafScheduled = false;
    const originalRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = () => {
      rafScheduled = true;
      return 0;
    };

    try {
      const ctx = {
        setTransform: () => {},
        clearRect: () => {},
        fillRect: () => {},
        fillStyle: "",
        strokeStyle: "",
        lineWidth: 0,
        strokeRect: () => {},
        createLinearGradient: () => ({ addColorStop: () => {} }),
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        closePath: () => {},
        fill: () => {},
      } as unknown as CanvasRenderingContext2D;
      let clearRectCalls = 0;
      ctx.clearRect = () => {
        clearRectCalls += 1;
      };
      const canvas = {
        width: 0,
        height: 0,
        style: { width: "", height: "" },
        getContext: () => ctx,
      } as unknown as HTMLCanvasElement;

      const renderer = new BoardRenderer(canvas);
      renderer.setViewportCssSize(100, 100);
      renderer.renderFull(
        bounds,
        () => ({ fill: "#000", isSelf: false, hasFlag: false, isPending: false }),
        [{ x: 0, y: 0 }],
      );
      rafScheduled = false;
      clearRectCalls = 0;
      renderer.setViewportCssSize(120, 90);
      expect(clearRectCalls).toBeGreaterThan(0);
      expect(rafScheduled).toBe(false);
    } finally {
      globalThis.requestAnimationFrame = originalRaf;
    }
  });
});
