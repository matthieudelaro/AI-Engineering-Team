const MIN_SCALE = 1;
const MAX_SCALE = 10;

interface Point {
  x: number;
  y: number;
}

interface TransformState {
  scale: number;
  translateX: number;
  translateY: number;
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

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

export interface MapZoomController {
  isPinching: () => boolean;
  reset: () => void;
}

export function initMapZoom(
  viewport: HTMLElement,
  board: HTMLElement,
): MapZoomController {
  const state: TransformState = { scale: 1, translateX: 0, translateY: 0 };
  let pinching = false;
  let lastDistance = 0;
  let panStart: Point | null = null;
  let panOrigin: Point | null = null;

  function applyTransform(): void {
    board.style.transform = `translate(${state.translateX}px, ${state.translateY}px) scale(${state.scale})`;
  }

  function focalPoint(touches: TouchList): Point {
    const center = touchCenter(touches);
    const rect = viewport.getBoundingClientRect();
    return {
      x: center.x - rect.left,
      y: center.y - rect.top,
    };
  }

  function zoomAt(focal: Point, nextScale: number): void {
    const clamped = clampScale(nextScale);
    const ratio = clamped / state.scale;
    state.translateX = focal.x - (focal.x - state.translateX) * ratio;
    state.translateY = focal.y - (focal.y - state.translateY) * ratio;
    state.scale = clamped;
    applyTransform();
  }

  function reset(): void {
    state.scale = 1;
    state.translateX = 0;
    state.translateY = 0;
    pinching = false;
    lastDistance = 0;
    panStart = null;
    panOrigin = null;
    applyTransform();
  }

  viewport.addEventListener(
    "touchstart",
    (event) => {
      if (event.touches.length === 2) {
        pinching = true;
        lastDistance = touchDistance(event.touches);
        panStart = null;
        panOrigin = null;
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
      if (panStart === null) {
        panStart = center;
        panOrigin = { x: state.translateX, y: state.translateY };
      } else if (panOrigin) {
        state.translateX = panOrigin.x + (center.x - panStart.x);
        state.translateY = panOrigin.y + (center.y - panStart.y);
        applyTransform();
      }
    },
    { passive: false },
  );

  viewport.addEventListener("touchend", (event) => {
    if (event.touches.length < 2) {
      pinching = false;
      lastDistance = 0;
      panStart = null;
      panOrigin = null;
    }
  });

  viewport.addEventListener("touchcancel", () => {
    pinching = false;
    lastDistance = 0;
    panStart = null;
    panOrigin = null;
  });

  applyTransform();

  return {
    isPinching: () => pinching,
    reset,
  };
}
