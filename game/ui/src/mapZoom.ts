const MAX_SCALE = 10;
const MIN_SCALE_FLOOR = 0.01;
/** Allow zooming out past full-map fit down to this fraction of that fit scale. */
export const MIN_SCALE_RELATIVE_TO_FIT = 0.15;
const FIT_PADDING_PX = 16;

/** Lowest zoom allowed after a fit — well below “map fills viewport”. */
export function minScaleFromFit(fitScale: number): number {
  return Math.max(MIN_SCALE_FLOOR, fitScale * MIN_SCALE_RELATIVE_TO_FIT);
}

interface Point {
  x: number;
  y: number;
}

interface TransformState {
  scale: number;
  translateX: number;
  translateY: number;
}

export interface FitTransform {
  scale: number;
  translateX: number;
  translateY: number;
}

/** Axis-aligned rectangle in board pixel space (pre-transform). */
export interface BoardRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function computeFitTransform(
  viewportWidth: number,
  viewportHeight: number,
  boardWidth: number,
  boardHeight: number,
  padding = FIT_PADDING_PX,
): FitTransform {
  if (boardWidth <= 0 || boardHeight <= 0 || viewportWidth <= 0 || viewportHeight <= 0) {
    return { scale: 1, translateX: 0, translateY: 0 };
  }

  const innerW = Math.max(1, viewportWidth - padding * 2);
  const innerH = Math.max(1, viewportHeight - padding * 2);
  const scale = Math.max(
    MIN_SCALE_FLOOR,
    Math.min(innerW / boardWidth, innerH / boardHeight),
  );
  return {
    scale,
    translateX: (viewportWidth - boardWidth * scale) / 2,
    translateY: (viewportHeight - boardHeight * scale) / 2,
  };
}

/** Fit a board-pixel rect into the viewport (centered), for content-focused defaults. */
export function computeFitRectTransform(
  viewportWidth: number,
  viewportHeight: number,
  rect: BoardRect,
  padding = FIT_PADDING_PX,
): FitTransform {
  if (
    rect.width <= 0 ||
    rect.height <= 0 ||
    viewportWidth <= 0 ||
    viewportHeight <= 0
  ) {
    return { scale: 1, translateX: 0, translateY: 0 };
  }

  const innerW = Math.max(1, viewportWidth - padding * 2);
  const innerH = Math.max(1, viewportHeight - padding * 2);
  const scale = Math.max(
    MIN_SCALE_FLOOR,
    Math.min(innerW / rect.width, innerH / rect.height),
  );
  return {
    scale,
    translateX: viewportWidth / 2 - (rect.x + rect.width / 2) * scale,
    translateY: viewportHeight / 2 - (rect.y + rect.height / 2) * scale,
  };
}

function touchDistance(touches: TouchList): number {
  if (touches.length < 2) {
    return 0;
  }
  const a = touches[0]!;
  const b = touches[1]!;
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function touchCenter(touches: TouchList): Point {
  const a = touches[0]!;
  const b = touches[1]!;
  return {
    x: (a.clientX + b.clientX) / 2,
    y: (a.clientY + b.clientY) / 2,
  };
}

export interface MapZoomCallbacks {
  getWorldSize: () => { width: number; height: number };
  getViewportSize: () => { width: number; height: number };
  getCamera: () => TransformState;
  setCamera: (camera: TransformState) => void;
  onPinchStart?: () => void;
  onPanStart?: () => void;
}

export interface MapZoomController {
  isPinching: () => boolean;
  isPanning: () => boolean;
  /** Fit the full board into the viewport. Returns false if sizes are not ready. */
  fitToView: () => boolean;
  /** Fit a board-pixel rect (e.g. claimed territory). Returns false if sizes are not ready. */
  fitToBoardRect: (rect: BoardRect) => boolean;
  reset: () => void;
}

function focalFromClient(viewport: HTMLElement, clientX: number, clientY: number): Point {
  const rect = viewport.getBoundingClientRect();
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  };
}

export function initMapZoom(
  viewport: HTMLElement,
  callbacks: MapZoomCallbacks,
): MapZoomController {
  let minScale = MIN_SCALE_FLOOR;
  let pinching = false;
  let lastDistance = 0;
  let touchPanStart: Point | null = null;
  let touchPanOrigin: Point | null = null;
  let dragPanning = false;
  let dragPointerId: number | null = null;
  let dragStart: Point | null = null;
  let dragOrigin: Point | null = null;

  function getState(): TransformState {
    return callbacks.getCamera();
  }

  function setState(state: TransformState): void {
    callbacks.setCamera(state);
  }

  function clampScale(value: number): number {
    return Math.min(MAX_SCALE, Math.max(minScale, value));
  }

  function sizesReady(): boolean {
    const { width: vw, height: vh } = callbacks.getViewportSize();
    const { width: ww, height: wh } = callbacks.getWorldSize();
    return vw > 0 && vh > 0 && ww > 0 && wh > 0;
  }

  /** Refresh the zoom-out floor from the full board size. */
  function updateMinScaleFromFullBoard(): void {
    const { width: vw, height: vh } = callbacks.getViewportSize();
    const { width: ww, height: wh } = callbacks.getWorldSize();
    const fullFit = computeFitTransform(vw, vh, ww, wh);
    minScale = minScaleFromFit(fullFit.scale);
  }

  function applyFit(fit: FitTransform): void {
    const state = getState();
    state.scale = clampScale(fit.scale);
    // Always use translate for the clamped scale so the board stays centered.
    const { width: vw, height: vh } = callbacks.getViewportSize();
    const cx = vw / 2;
    const cy = vh / 2;
    const boardCx = (cx - fit.translateX) / fit.scale;
    const boardCy = (cy - fit.translateY) / fit.scale;
    state.translateX = cx - boardCx * state.scale;
    state.translateY = cy - boardCy * state.scale;
    setState(state);
  }

  function focalPoint(touches: TouchList): Point {
    const center = touchCenter(touches);
    return focalFromClient(viewport, center.x, center.y);
  }

  function panBy(deltaX: number, deltaY: number): void {
    const state = getState();
    state.translateX += deltaX;
    state.translateY += deltaY;
    setState(state);
  }

  function zoomAt(focal: Point, nextScale: number): void {
    const state = getState();
    const clamped = clampScale(nextScale);
    const ratio = clamped / state.scale;
    state.translateX = focal.x - (focal.x - state.translateX) * ratio;
    state.translateY = focal.y - (focal.y - state.translateY) * ratio;
    state.scale = clamped;
    setState(state);
  }

  function fitToView(): boolean {
    if (!sizesReady()) {
      return false;
    }
    const { width: vw, height: vh } = callbacks.getViewportSize();
    const { width: ww, height: wh } = callbacks.getWorldSize();
    updateMinScaleFromFullBoard();
    applyFit(computeFitTransform(vw, vh, ww, wh));
    return true;
  }

  function fitToBoardRect(rect: BoardRect): boolean {
    if (!sizesReady()) {
      return false;
    }
    const { width: vw, height: vh } = callbacks.getViewportSize();
    updateMinScaleFromFullBoard();
    applyFit(computeFitRectTransform(vw, vh, rect));
    return true;
  }

  function reset(): void {
    pinching = false;
    lastDistance = 0;
    touchPanStart = null;
    touchPanOrigin = null;
    dragPanning = false;
    dragPointerId = null;
    dragStart = null;
    dragOrigin = null;
    fitToView();
  }

  function isPanButton(button: number): boolean {
    return button === 1 || button === 2;
  }

  function beginDragPan(event: PointerEvent): void {
    if (!isPanButton(event.button)) {
      return;
    }
    event.preventDefault();
    dragPanning = true;
    dragPointerId = event.pointerId;
    dragStart = { x: event.clientX, y: event.clientY };
    const state = getState();
    dragOrigin = { x: state.translateX, y: state.translateY };
    viewport.setPointerCapture(event.pointerId);
    callbacks.onPanStart?.();
  }

  function moveDragPan(event: PointerEvent): void {
    if (!dragPanning || event.pointerId !== dragPointerId || !dragStart || !dragOrigin) {
      return;
    }
    const state = getState();
    state.translateX = dragOrigin.x + (event.clientX - dragStart.x);
    state.translateY = dragOrigin.y + (event.clientY - dragStart.y);
    setState(state);
  }

  function endDragPan(event: PointerEvent): void {
    if (event.pointerId !== dragPointerId) {
      return;
    }
    dragPanning = false;
    dragPointerId = null;
    dragStart = null;
    dragOrigin = null;
    if (viewport.hasPointerCapture(event.pointerId)) {
      viewport.releasePointerCapture(event.pointerId);
    }
  }

  viewport.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });

  viewport.addEventListener("pointerdown", beginDragPan);
  viewport.addEventListener("pointermove", moveDragPan);
  viewport.addEventListener("pointerup", endDragPan);
  viewport.addEventListener("pointercancel", endDragPan);

  viewport.addEventListener(
    "touchstart",
    (event) => {
      if (event.touches.length === 2) {
        pinching = true;
        lastDistance = touchDistance(event.touches);
        touchPanStart = null;
        touchPanOrigin = null;
        callbacks.onPinchStart?.();
      }
    },
    { passive: false },
  );

  viewport.addEventListener(
    "touchmove",
    (event) => {
      if (event.touches.length !== 2 || !pinching) {
        return;
      }
      event.preventDefault();

      const distance = touchDistance(event.touches);
      if (lastDistance > 0 && distance > 0) {
        const focal = focalPoint(event.touches);
        const state = getState();
        zoomAt(focal, state.scale * (distance / lastDistance));
      }
      lastDistance = distance;

      const center = touchCenter(event.touches);
      if (touchPanStart === null) {
        touchPanStart = center;
        const state = getState();
        touchPanOrigin = { x: state.translateX, y: state.translateY };
      } else if (touchPanOrigin) {
        const state = getState();
        state.translateX = touchPanOrigin.x + (center.x - touchPanStart.x);
        state.translateY = touchPanOrigin.y + (center.y - touchPanStart.y);
        setState(state);
      }
    },
    { passive: false },
  );

  viewport.addEventListener("touchend", (event) => {
    if (event.touches.length < 2) {
      pinching = false;
      lastDistance = 0;
      touchPanStart = null;
      touchPanOrigin = null;
    }
  });

  viewport.addEventListener("touchcancel", () => {
    pinching = false;
    lastDistance = 0;
    touchPanStart = null;
    touchPanOrigin = null;
  });

  viewport.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const focal = focalFromClient(viewport, event.clientX, event.clientY);
        const state = getState();
        const factor = Math.exp(-event.deltaY * 0.002);
        zoomAt(focal, state.scale * factor);
        return;
      }
      panBy(-event.deltaX, -event.deltaY);
    },
    { passive: false },
  );

  return {
    isPinching: () => pinching,
    isPanning: () => dragPanning,
    fitToView,
    fitToBoardRect,
    reset,
  };
}
