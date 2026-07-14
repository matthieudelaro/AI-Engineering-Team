const MAX_SCALE = 10;
const MIN_SCALE_FLOOR = 0.01;
const FIT_PADDING_PX = 16;

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
  const scale = Math.min(innerW / boardWidth, innerH / boardHeight);
  return {
    scale: Math.max(MIN_SCALE_FLOOR, scale),
    translateX: (viewportWidth - boardWidth * scale) / 2,
    translateY: (viewportHeight - boardHeight * scale) / 2,
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

export interface MapZoomOptions {
  onPinchStart?: () => void;
  onPanStart?: () => void;
}

export interface MapZoomController {
  isPinching: () => boolean;
  isPanning: () => boolean;
  fitToView: () => void;
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
  board: HTMLElement,
  options: MapZoomOptions = {},
): MapZoomController {
  const state: TransformState = { scale: 1, translateX: 0, translateY: 0 };
  let minScale = MIN_SCALE_FLOOR;
  let pinching = false;
  let lastDistance = 0;
  let touchPanStart: Point | null = null;
  let touchPanOrigin: Point | null = null;
  let dragPanning = false;
  let dragPointerId: number | null = null;
  let dragStart: Point | null = null;
  let dragOrigin: Point | null = null;

  function applyTransform(): void {
    board.style.transform = `translate(${state.translateX}px, ${state.translateY}px) scale(${state.scale})`;
  }

  function clampScale(value: number): number {
    return Math.min(MAX_SCALE, Math.max(minScale, value));
  }

  function focalPoint(touches: TouchList): Point {
    const center = touchCenter(touches);
    return focalFromClient(viewport, center.x, center.y);
  }

  function panBy(deltaX: number, deltaY: number): void {
    state.translateX += deltaX;
    state.translateY += deltaY;
    applyTransform();
  }

  function zoomAt(focal: Point, nextScale: number): void {
    const clamped = clampScale(nextScale);
    const ratio = clamped / state.scale;
    state.translateX = focal.x - (focal.x - state.translateX) * ratio;
    state.translateY = focal.y - (focal.y - state.translateY) * ratio;
    state.scale = clamped;
    applyTransform();
  }

  function fitToView(): void {
    const fit = computeFitTransform(
      viewport.clientWidth,
      viewport.clientHeight,
      board.offsetWidth,
      board.offsetHeight,
    );
    state.scale = fit.scale;
    state.translateX = fit.translateX;
    state.translateY = fit.translateY;
    minScale = fit.scale;
    applyTransform();
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
    dragOrigin = { x: state.translateX, y: state.translateY };
    viewport.setPointerCapture(event.pointerId);
    options.onPanStart?.();
  }

  function moveDragPan(event: PointerEvent): void {
    if (!dragPanning || event.pointerId !== dragPointerId || !dragStart || !dragOrigin) {
      return;
    }
    state.translateX = dragOrigin.x + (event.clientX - dragStart.x);
    state.translateY = dragOrigin.y + (event.clientY - dragStart.y);
    applyTransform();
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
  board.addEventListener("pointerdown", beginDragPan);
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
        options.onPinchStart?.();
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
        zoomAt(focal, state.scale * (distance / lastDistance));
      }
      lastDistance = distance;

      const center = touchCenter(event.touches);
      if (touchPanStart === null) {
        touchPanStart = center;
        touchPanOrigin = { x: state.translateX, y: state.translateY };
      } else if (touchPanOrigin) {
        state.translateX = touchPanOrigin.x + (center.x - touchPanStart.x);
        state.translateY = touchPanOrigin.y + (center.y - touchPanStart.y);
        applyTransform();
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
        const factor = Math.exp(-event.deltaY * 0.002);
        zoomAt(focal, state.scale * factor);
        return;
      }
      panBy(-event.deltaX, -event.deltaY);
    },
    { passive: false },
  );

  applyTransform();

  return {
    isPinching: () => pinching,
    isPanning: () => dragPanning,
    fitToView,
    reset,
  };
}
