import "./style.css";
import {
  bindRateBudget,
  enqueueUiClaims,
  fetchFlags,
  launchNuke,
  fetchLeaderboard,
  fetchMapLive,
  fetchMapResolved,
  formatCacheAge,
  isNukedTile,
  isSelfOwner,
  isSelfTile,
  mapStreamUrl,
  ownershipColor,
  ownershipName,
  touchUiClaimActivity,
  type CachedReadMeta,
} from "./api.js";
import {
  activeFlagKeys,
  cellHasActiveFlag,
  mergeFlagCoordsIntoRender,
} from "./flagOverlay.js";
import { SELF_MAP_COLOR, buildPlayerColors, mapColorForPlayer } from "./playerColors.js";
import { initMapZoom } from "./mapZoom.js";
import { initApiConsole, logApiCall } from "./apiConsole.js";
import { initRatePanel } from "./ratePanel.js";
import { initClaimQueuePanel } from "./claimQueuePanel.js";
import { applyMapStreamEvent, subscribeMapStream, type MapStreamEvent } from "./mapStream.js";
import {
  brushRadiusFromModifiers,
  diamondCells,
  lassoEdgeCells,
  lineCells,
  type BrushModifiers,
} from "./claimDiamond.js";
import { formatNukeStatus } from "./nukeAction.js";
import { initNukeToast } from "./nukeToast.js";
import { UiClaimBatcher } from "./uiClaimBatch.js";
import { PLAYER_ID } from "./config.js";
import { UI_FEATURES } from "./features.js";
import { RateBudget } from "./rateBudget.js";
import {
  BoardRenderer,
  compensateCameraForBoundsChange,
  type BoardCellState,
} from "./boardCanvas.js";
import type { BoundBox, LeaderboardEntry, MapResponse, PlayerColors, Tile } from "./types.js";

const LEADERBOARD_POLL_MS = 3000;
/** Max staleness for map display — sync from postgres cache on this interval. */
const MAP_SYNC_MS = 5000;
/** Flags cache poll — same cadence as map sync (fog cells omit has_flag). */
const FLAGS_POLL_MS = MAP_SYNC_MS;
const statsEl = document.getElementById("stats");
const statusEl = document.getElementById("status");
const boardEl = document.getElementById("board");
const boardErrorEl = document.getElementById("board-error");
const boardViewportEl = document.getElementById("board-viewport");
const leaderboardEl = document.getElementById("leaderboard");
const apiConsoleEl = document.getElementById("api-console");
const ratePanelEl = document.getElementById("rate-panel");
const claimQueuePanelEl = document.getElementById("claim-queue-panel");
const nukeToastEl = document.getElementById("nuke-toast");

if (
  !statsEl ||
  !statusEl ||
  !(boardEl instanceof HTMLCanvasElement) ||
  !boardErrorEl ||
  !boardViewportEl ||
  !leaderboardEl ||
  !apiConsoleEl ||
  !ratePanelEl
) {
  throw new Error("missing DOM elements");
}

const boardRenderer = new BoardRenderer(boardEl);

const mapZoom = initMapZoom(boardViewportEl, {
  getWorldSize: () => boardRenderer.fitWorldSize(),
  getViewportSize: () => ({
    width: boardViewportEl.clientWidth,
    height: boardViewportEl.clientHeight,
  }),
  getCamera: () => boardRenderer.getCamera(),
  setCamera: (camera) => {
    boardRenderer.setCamera(camera);
  },
  onPinchStart: () => {
    stopPainting();
    releasePaintCapture();
  },
  onPanStart: () => {
    stopPainting();
    releasePaintCapture();
  },
});

function markPanelLightModeDisabled(root: HTMLElement): void {
  root.replaceChildren();
  const note = document.createElement("p");
  note.textContent = "disabled (light mode)";
  root.appendChild(note);
}

if (UI_FEATURES.apiConsole) {
  initApiConsole(apiConsoleEl);
} else {
  markPanelLightModeDisabled(apiConsoleEl);
}

if (UI_FEATURES.ratePanel) {
  initRatePanel(ratePanelEl);
} else {
  markPanelLightModeDisabled(ratePanelEl);
}

const rateBudget = new RateBudget();
bindRateBudget(rateBudget);

let playerColors: PlayerColors = {
  selfName: null,
  selfColor: SELF_MAP_COLOR,
  byName: new Map(),
};
/** Active non-nuked flag cells from gateway flags cache (`x,y` keys). */
let activeFlags = new Set<string>();

let latestMap: MapResponse | null = null;
let latestLeaderboard: LeaderboardEntry[] = [];
let mapCacheAge = "";
let mapDataSource: CachedReadMeta["source"] = "postgres";
let mapLive = false;
let mapStreamOffline = false;
let streamCatchingUp = true;
let streamFlushTimer: ReturnType<typeof setTimeout> | null = null;
let boundsExpandedPending = false;
let lastPlayerColorKey = "";
let leaderboardCacheAge = "";
let lastBounds: BoundBox | null = null;
let painting = false;
let paintPointerId: number | null = null;
let lastPaintCell: { x: number; y: number } | null = null;
let lastUiActivityTouch = 0;
const heldBrushKeys = { a: false, s: false, d: false, f: false, n: false, z: false };
/** Cell under the pointer when not painting (for F-hover). */
let hoverCell: { x: number; y: number } | null = null;
/** Last cell stamped by F-hover so we do not re-stamp every move. */
let lastLassoHoverCell: { x: number; y: number } | null = null;
const tileIndex = new Map<string, Tile>();
const pendingCells = new Set<string>();
/** Retry content-fit when the viewport/board was not laid out yet. */
let pendingViewFit = false;

const claimBatcher = new UiClaimBatcher((tiles) => {
  enqueueUiClaims(tiles);
});

/** Drop local pending paint + unsent batch when the gateway queue is emptied. */
function clearLocalPendingClaims(): void {
  claimBatcher.clear();
  if (pendingCells.size === 0) {
    return;
  }
  pendingCells.clear();
  if (latestMap) {
    renderBoard(latestMap);
  }
}

if (claimQueuePanelEl) {
  if (UI_FEATURES.claimQueuePanel) {
    initClaimQueuePanel(claimQueuePanelEl, {
      onCleared: clearLocalPendingClaims,
    });
  } else {
    markPanelLightModeDisabled(claimQueuePanelEl);
  }
}

const nukeToast = nukeToastEl ? initNukeToast(nukeToastEl) : null;

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function maybeTouchUiActivity(force = false): void {
  const now = Date.now();
  if (force || now - lastUiActivityTouch >= 250) {
    lastUiActivityTouch = now;
    touchUiClaimActivity();
  }
}

function setStatus(message: string): void {
  statusEl.textContent = message;
}

async function fireNukeAt(x: number, y: number): Promise<void> {
  try {
    const response = await launchNuke(x, y);
    if (response.accepted) {
      nukeToast?.notifyUiAccepted(x, y, response.accepted.effect);
    } else if (response.rejected) {
      const retryAfter = response.rejected.retry_after;
      if (retryAfter !== undefined && retryAfter > 0) {
        nukeToast?.notifyUiRejected(retryAfter);
      }
      setStatus(formatNukeStatus(x, y, response));
    } else {
      setStatus(formatNukeStatus(x, y, response));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "nuke failed";
    setStatus(message);
  }
}

function updateStats(): void {
  if (!latestMap) {
    statsEl.textContent = "Waiting for map…";
    return;
  }
  const selfTiles = [...tileIndex.values()].filter((t) =>
    isSelfTile(t.ownership, playerColors.selfName, PLAYER_ID),
  ).length;
  const total = latestMap.tiles.length;
  const name = playerColors.selfName ?? "you";
  const mapSourceLabel = mapLive
    ? "stream + live"
    : mapStreamOffline
      ? "live (stream offline)"
      : mapDataSource === "live"
        ? "live"
        : "cache";
  statsEl.textContent = `${name}: ${selfTiles} tiles · map shows ${total} claimed · ${rateBudget.label()} · map ${mapSourceLabel}${mapCacheAge ? ` (${mapCacheAge})` : ""}, lb ${leaderboardCacheAge} · bounds (${latestMap.bounds.min_x}…${latestMap.bounds.max_x}, ${latestMap.bounds.min_y}…${latestMap.bounds.max_y})`;
}

function boundsEqual(a: BoundBox, b: BoundBox): boolean {
  return (
    a.min_x === b.min_x &&
    a.min_y === b.min_y &&
    a.max_x === b.max_x &&
    a.max_y === b.max_y
  );
}

function boundsExpanded(previous: BoundBox, next: BoundBox): boolean {
  return (
    next.min_x < previous.min_x ||
    next.min_y < previous.min_y ||
    next.max_x > previous.max_x ||
    next.max_y > previous.max_y
  );
}

function renderLeaderboard(entries: LeaderboardEntry[]): void {
  leaderboardEl.replaceChildren();
  if (entries.length === 0) {
    const empty = document.createElement("li");
    empty.className = "leaderboard-empty";
    empty.textContent = "No players yet";
    leaderboardEl.appendChild(empty);
    return;
  }

  for (const entry of entries) {
    const item = document.createElement("li");
    item.className = "leaderboard-entry";
    if (entry.is_self) {
      item.classList.add("self");
    }

    const swatch = document.createElement("span");
    swatch.className = "leaderboard-swatch";
    swatch.style.backgroundColor = mapColorForPlayer(entry.display_name, playerColors);
    swatch.title =
      entry.color !== mapColorForPlayer(entry.display_name, playerColors)
        ? `API color ${entry.color}`
        : entry.color;
    swatch.setAttribute("aria-hidden", "true");

    const name = document.createElement("span");
    name.className = "leaderboard-name";
    name.textContent = entry.display_name;

    const meta = document.createElement("span");
    meta.className = "leaderboard-meta";
    const score = entry.score ?? 0;
    const flags = entry.flags_held ?? 0;
    meta.textContent = `${entry.tile_count} tiles · ${flags} flags · ${score.toLocaleString()} pts`;

    item.append(swatch, name, meta);
    leaderboardEl.appendChild(item);
  }
}

async function loadIdentity(): Promise<void> {
  try {
    const { data: leaderboard, meta } = await fetchLeaderboard();
    leaderboardCacheAge = formatCacheAge(meta.fetchedAt);
    latestLeaderboard = leaderboard.entries;
    const previous: PlayerColors = {
      selfName: playerColors.selfName,
      selfColor: playerColors.selfColor,
      byName: new Map(playerColors.byName),
    };
    const resolved = buildPlayerColors(leaderboard.entries, previous);
    playerColors.selfName = resolved.selfName;
    playerColors.selfColor = resolved.selfColor;
    playerColors.byName.clear();
    for (const [name, color] of resolved.byName) {
      playerColors.byName.set(name, color);
    }
    renderLeaderboard(latestLeaderboard);
    const colorKey = `${resolved.selfName ?? ""}:${resolved.selfColor}:${[...resolved.byName.entries()].sort().join("|")}`;
    if (latestMap && !painting && colorKey !== lastPlayerColorKey) {
      lastPlayerColorKey = colorKey;
      renderBoard(latestMap);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "leaderboard error";
    setStatus(message);
    leaderboardEl.replaceChildren();
    const err = document.createElement("li");
    err.className = "leaderboard-empty";
    err.textContent = message;
    leaderboardEl.appendChild(err);
  }
}

async function loadFlags(): Promise<void> {
  try {
    const { data } = await fetchFlags();
    const next = activeFlagKeys(data.flags);
    let changed = next.size !== activeFlags.size;
    if (!changed) {
      for (const key of next) {
        if (!activeFlags.has(key)) {
          changed = true;
          break;
        }
      }
    }
    activeFlags = next;
    if (changed && latestMap && !painting) {
      renderBoard(latestMap);
    }
  } catch {
    // Keep last good flag overlay; map tiles may still carry has_flag.
  }
}

function rebuildTileIndex(map: MapResponse): void {
  tileIndex.clear();
  for (const tile of map.tiles) {
    tileIndex.set(cellKey(tile.x, tile.y), tile);
  }
}

function colorForTile(tile: Tile | undefined): string {
  if (!tile) {
    return "#1e2836";
  }
  const owner = ownershipName(tile.ownership);
  if (isSelfOwner(owner, playerColors.selfName, PLAYER_ID)) {
    return playerColors.selfColor;
  }
  return ownershipColor(tile.ownership, playerColors) ?? "#5b6b82";
}

function cellStateFor(x: number, y: number, tile: Tile | undefined): BoardCellState {
  const owner = tile ? ownershipName(tile.ownership) : null;
  return {
    fill: colorForTile(tile),
    isSelf: isSelfOwner(owner, playerColors.selfName, PLAYER_ID),
    hasFlag: cellHasActiveFlag(x, y, tile?.has_flag ?? false, activeFlags),
    isPending: pendingCells.has(cellKey(x, y)),
  };
}

function cellTitle(x: number, y: number, tile: Tile | undefined): string {
  const owner = tile ? ownershipName(tile.ownership) : null;
  if (cellHasActiveFlag(x, y, tile?.has_flag ?? false, activeFlags)) {
    return `${owner ?? "unknown"} — flag (${x}, ${y})`;
  }
  if (owner) {
    return `${owner} (${x}, ${y})`;
  }
  return `empty (${x}, ${y})`;
}

function hideBoardError(): void {
  boardErrorEl.hidden = true;
  boardErrorEl.textContent = "";
}

function showBoardError(message: string): void {
  boardErrorEl.textContent = `Cannot load map: ${message}`;
  boardErrorEl.hidden = false;
}

function clearPendingIfResolved(x: number, y: number, tile: Tile | undefined): void {
  if (!pendingCells.has(cellKey(x, y))) {
    return;
  }
  const owner = tile ? ownershipName(tile.ownership) : null;
  if (owner) {
    pendingCells.delete(cellKey(x, y));
  }
}

function updateCell(x: number, y: number, tile: Tile | undefined): boolean {
  if (!boardRenderer.containsCell(x, y)) {
    return false;
  }
  clearPendingIfResolved(x, y, tile);
  boardRenderer.paintCell(x, y, cellStateFor(x, y, tile));
  return true;
}

function collectRenderCoords(): Array<{ x: number; y: number }> {
  const coords: Array<{ x: number; y: number }> = [];
  const seen = new Set<string>();
  for (const tile of tileIndex.values()) {
    const key = cellKey(tile.x, tile.y);
    if (!seen.has(key)) {
      seen.add(key);
      coords.push({ x: tile.x, y: tile.y });
    }
  }
  for (const key of pendingCells) {
    if (seen.has(key)) {
      continue;
    }
    const [xs, ys] = key.split(",");
    coords.push({
      x: Number.parseInt(xs!, 10),
      y: Number.parseInt(ys!, 10),
    });
  }
  return mergeFlagCoordsIntoRender(coords, activeFlags);
}

/** Fit the camera once viewport and world sizes are ready. */
function applyMapViewFit(): boolean {
  if (boardViewportEl.clientWidth <= 0 || boardViewportEl.clientHeight <= 0) {
    return false;
  }
  return mapZoom.fitToView();
}

function scheduleMapViewFit(): void {
  pendingViewFit = true;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!pendingViewFit) {
        return;
      }
      if (applyMapViewFit()) {
        pendingViewFit = false;
      }
    });
  });
}

function renderBoard(map: MapResponse, refit = false): void {
  hideBoardError();
  const previousBounds = boardRenderer.getBounds();
  const previousCamera = boardRenderer.getCamera();
  boardRenderer.renderFull(
    map.bounds,
    (x, y) => {
      const tile = tileIndex.get(cellKey(x, y));
      return cellStateFor(x, y, tile);
    },
    collectRenderCoords(),
  );

  if (
    previousBounds !== null &&
    !refit &&
    !boundsEqual(previousBounds, map.bounds)
  ) {
    boardRenderer.setCamera(
      compensateCameraForBoundsChange(previousBounds, map.bounds, previousCamera),
    );
  }

  if (refit) {
    // Fit synchronously when layout is ready so the first paint is not at scale=1.
    if (!applyMapViewFit()) {
      scheduleMapViewFit();
    }
  }
}

function isOwnTile(x: number, y: number): boolean {
  const tile = tileIndex.get(cellKey(x, y));
  if (!tile) {
    return false;
  }
  return isSelfTile(tile.ownership, playerColors.selfName, PLAYER_ID);
}

function markCellPending(x: number, y: number): void {
  const tile = tileIndex.get(cellKey(x, y));
  boardRenderer.paintCell(x, y, cellStateFor(x, y, tile));
}

function isNukedMapTile(x: number, y: number): boolean {
  const tile = tileIndex.get(cellKey(x, y));
  if (!tile) {
    return false;
  }
  return isNukedTile(tile.ownership);
}

function tryClaimOne(x: number, y: number): void {
  if (isOwnTile(x, y)) {
    return;
  }
  if (isNukedMapTile(x, y)) {
    return;
  }
  const k = cellKey(x, y);
  if (pendingCells.has(k)) {
    return;
  }
  pendingCells.add(k);
  claimBatcher.enqueue(x, y);
  markCellPending(x, y);
}

function brushModifiersFromEvent(event: PointerEvent | MouseEvent | KeyboardEvent): BrushModifiers {
  return {
    shift: event.shiftKey,
    a: heldBrushKeys.a,
    s: heldBrushKeys.s,
    d: heldBrushKeys.d,
    f: heldBrushKeys.f,
    z: heldBrushKeys.z,
  };
}

function stampLasso(x: number, y: number): void {
  for (const cell of lassoEdgeCells(x, y)) {
    tryClaimOne(cell.x, cell.y);
  }
}

function stampBrush(x: number, y: number, radius: number): void {
  if (radius <= 0) {
    tryClaimOne(x, y);
    return;
  }
  for (const cell of diamondCells(x, y, radius)) {
    tryClaimOne(cell.x, cell.y);
  }
}

/** Claim along the stroke, filling gaps between sparse pointer samples. */
function paintStroke(x: number, y: number, mods: BrushModifiers): void {
  if (playerColors.selfName === null) {
    return;
  }
  const path =
    lastPaintCell === null
      ? [{ x, y }]
      : lineCells(lastPaintCell, { x, y });
  if (mods.f) {
    for (const cell of path) {
      stampLasso(cell.x, cell.y);
    }
  } else {
    const radius = brushRadiusFromModifiers(mods);
    for (const cell of path) {
      stampBrush(cell.x, cell.y, radius);
    }
  }
  lastPaintCell = { x, y };
}

/** F held + hover (no button): stamp one lasso when the hit cell changes. */
function maybeLassoHover(x: number, y: number): void {
  if (!heldBrushKeys.f || playerColors.selfName === null) {
    return;
  }
  if (
    lastLassoHoverCell !== null &&
    lastLassoHoverCell.x === x &&
    lastLassoHoverCell.y === y
  ) {
    return;
  }
  lastLassoHoverCell = { x, y };
  maybeTouchUiActivity();
  stampLasso(x, y);
  claimBatcher.flushNow();
}

function tileChanged(previous: Tile | undefined, next: Tile): boolean {
  if (!previous) {
    return true;
  }
  if (previous.has_flag !== next.has_flag) {
    return true;
  }
  return ownershipName(previous.ownership) !== ownershipName(next.ownership);
}

function applyMapSnapshot(map: MapResponse, meta: CachedReadMeta): void {
  mapDataSource = meta.source;
  mapCacheAge =
    meta.source === "live" ? "just now" : formatCacheAge(meta.fetchedAt);

  const previousBounds = lastBounds ? { ...lastBounds } : null;
  const expanded =
    previousBounds !== null &&
    !boundsEqual(previousBounds, map.bounds) &&
    boundsExpanded(previousBounds, map.bounds);
  const boundsChanged =
    previousBounds !== null && !boundsEqual(previousBounds, map.bounds);
  const isInitial = previousBounds === null;

  latestMap = map;

  if (isInitial || expanded || boundsChanged) {
    rebuildTileIndex(map);
    if (!painting) {
      pendingCells.clear();
      renderBoard(map, isInitial);
    }
    lastBounds = { ...map.bounds };
    updateStats();
    if (expanded) {
      void loadIdentity();
    }
    return;
  }

  const previousKeys = new Set(tileIndex.keys());
  const nextKeys = new Set(map.tiles.map((tile) => cellKey(tile.x, tile.y)));

  let needsFullRender = false;
  if (!painting) {
    for (const tile of map.tiles) {
      const previous = tileIndex.get(cellKey(tile.x, tile.y));
      if (tileChanged(previous, tile)) {
        clearPendingIfResolved(tile.x, tile.y, tile);
        if (!updateCell(tile.x, tile.y, tile)) {
          needsFullRender = true;
          break;
        }
      }
    }

    if (!needsFullRender) {
      for (const key of previousKeys) {
        if (nextKeys.has(key)) {
          continue;
        }
        const [xs, ys] = key.split(",");
        const x = Number.parseInt(xs!, 10);
        const y = Number.parseInt(ys!, 10);
        if (!updateCell(x, y, undefined)) {
          needsFullRender = true;
          break;
        }
      }
    }
  }

  rebuildTileIndex(map);

  if (needsFullRender && !painting) {
    pendingCells.clear();
    renderBoard(map, false);
  }

  lastBounds = { ...map.bounds };
  updateStats();
}

async function refreshMap(): Promise<void> {
  try {
    let map: MapResponse;
    let meta: CachedReadMeta;
    try {
      map = await fetchMapLive();
      meta = { fetchedAt: new Date().toISOString(), source: "live" };
    } catch {
      const resolved = await fetchMapResolved();
      map = resolved.data;
      meta = resolved.meta;
    }

    applyMapSnapshot(map, meta);

    hideBoardError();
    if (!mapStreamOffline) {
      setStatus("");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "map error";
    if (!latestMap) {
      showBoardError(message);
      setStatus(message);
    } else {
      updateStats();
    }
  }
}

function handleStreamOffline(detail: string, status = 0): void {
  streamCatchingUp = false;
  mapLive = false;
  mapStreamOffline = true;
  logApiCall({
    method: "GET",
    path: "/api/v1/games/…/map/stream (game API)",
    status,
    ok: false,
    body: null,
    error: detail,
  });
  if (latestMap) {
    setStatus("");
    updateStats();
    return;
  }
  setStatus(detail);
}

function handleStreamConnected(): void {
  mapStreamOffline = false;
  if (latestMap) {
    scheduleStreamFlush();
  }
}

function cellFromPointer(event: PointerEvent): { x: number; y: number } | null {
  const rect = boardEl.getBoundingClientRect();
  const cssX = event.clientX - rect.left;
  const cssY = event.clientY - rect.top;
  return boardRenderer.hitTest(cssX, cssY);
}

function releasePaintCapture(): void {
  if (paintPointerId !== null && boardEl.hasPointerCapture(paintPointerId)) {
    boardEl.releasePointerCapture(paintPointerId);
  }
  paintPointerId = null;
}

function stopPainting(): void {
  if (!painting) {
    return;
  }
  painting = false;
  lastPaintCell = null;
  claimBatcher.flushNow();
  releasePaintCapture();
  if (latestMap) {
    renderBoard(latestMap);
  }
}

function setBrushKey(code: string, down: boolean): void {
  if (code === "KeyA") {
    heldBrushKeys.a = down;
  } else if (code === "KeyS") {
    heldBrushKeys.s = down;
  } else if (code === "KeyD") {
    heldBrushKeys.d = down;
  } else if (code === "KeyF") {
    heldBrushKeys.f = down;
    if (!down) {
      lastLassoHoverCell = null;
    }
  } else if (code === "KeyN") {
    heldBrushKeys.n = down;
  } else if (code === "KeyZ") {
    heldBrushKeys.z = down;
  }
}

window.addEventListener("keydown", (event) => {
  if (event.repeat) {
    return;
  }
  setBrushKey(event.code, true);
  if (event.code === "KeyF" && !painting && hoverCell) {
    maybeLassoHover(hoverCell.x, hoverCell.y);
  }
});

window.addEventListener("keyup", (event) => {
  setBrushKey(event.code, false);
});

window.addEventListener("blur", () => {
  heldBrushKeys.a = false;
  heldBrushKeys.s = false;
  heldBrushKeys.d = false;
  heldBrushKeys.f = false;
  heldBrushKeys.n = false;
  heldBrushKeys.z = false;
  lastLassoHoverCell = null;
  // keep hoverCell — pointer position is still valid when focus returns
});

boardEl.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || mapZoom.isPinching() || mapZoom.isPanning()) {
    return;
  }
  if (heldBrushKeys.n) {
    const pos = cellFromPointer(event);
    if (pos) {
      void fireNukeAt(pos.x, pos.y);
    }
    return;
  }
  painting = true;
  lastPaintCell = null;
  paintPointerId = event.pointerId;
  boardEl.setPointerCapture(event.pointerId);
  const pos = cellFromPointer(event);
  if (pos) {
    maybeTouchUiActivity(true);
    paintStroke(pos.x, pos.y, brushModifiersFromEvent(event));
  }
});

boardEl.addEventListener("pointermove", (event) => {
  if (!painting) {
    const pos = cellFromPointer(event);
    if (pos) {
      hoverCell = { x: pos.x, y: pos.y };
      const tile = tileIndex.get(cellKey(pos.x, pos.y));
      boardEl.title = cellTitle(pos.x, pos.y, tile);
      maybeLassoHover(pos.x, pos.y);
    } else {
      hoverCell = null;
      boardEl.removeAttribute("title");
      lastLassoHoverCell = null;
    }
    return;
  }
  if (mapZoom.isPinching()) {
    return;
  }
  const pos = cellFromPointer(event);
  if (pos) {
    maybeTouchUiActivity();
    paintStroke(pos.x, pos.y, brushModifiersFromEvent(event));
  }
});

boardEl.addEventListener("pointerup", (event) => {
  if (paintPointerId === event.pointerId) {
    releasePaintCapture();
  }
  maybeTouchUiActivity(true);
  stopPainting();
});

boardEl.addEventListener("pointercancel", (event) => {
  if (paintPointerId === event.pointerId) {
    releasePaintCapture();
  }
  maybeTouchUiActivity(true);
  stopPainting();
});

window.addEventListener("mouseup", () => {
  stopPainting();
});

boardEl.addEventListener("dragstart", (event) => {
  event.preventDefault();
});

boardViewportEl.addEventListener("touchstart", (event) => {
  if (event.touches.length >= 2) {
    stopPainting();
    releasePaintCapture();
  }
});

new ResizeObserver(() => {
  boardRenderer.setViewportCssSize(
    boardViewportEl.clientWidth,
    boardViewportEl.clientHeight,
  );
  if (pendingViewFit) {
    if (applyMapViewFit()) {
      pendingViewFit = false;
    }
  }
}).observe(boardViewportEl);

boardRenderer.setViewportCssSize(
  boardViewportEl.clientWidth,
  boardViewportEl.clientHeight,
);

function scheduleStreamFlush(): void {
  if (streamFlushTimer) {
    clearTimeout(streamFlushTimer);
  }
  streamFlushTimer = setTimeout(() => {
    streamFlushTimer = null;
    streamCatchingUp = false;
    mapLive = !mapStreamOffline;
    updateStats();
  }, 250);
}

function handleMapStreamBatch(events: MapStreamEvent[]): void {
  if (!latestMap || events.length === 0) {
    return;
  }

  if (streamCatchingUp) {
    scheduleStreamFlush();
    return;
  }

  let needsFullRender = false;
  const previousBounds = lastBounds ? { ...lastBounds } : null;

  for (const event of events) {
    if (!applyMapStreamEvent(latestMap, tileIndex, event)) {
      continue;
    }

    mapLive = true;
    const x = event.detail.x;
    const y = event.detail.y;

    if (typeof x === "number" && typeof y === "number") {
      const tile = tileIndex.get(cellKey(x, y));
      clearPendingIfResolved(x, y, tile);
      if (!updateCell(x, y, tile)) {
        needsFullRender = true;
      }
    }
  }

  lastBounds = { ...latestMap.bounds };
  const boundsExpandedNow =
    previousBounds !== null &&
    !boundsEqual(previousBounds, latestMap.bounds) &&
    boundsExpanded(previousBounds, latestMap.bounds);
  if (boundsExpandedNow) {
    boundsExpandedPending = true;
  }

  if (needsFullRender && latestMap && !painting) {
    renderBoard(latestMap, false);
  }
  if (boundsExpandedPending) {
    boundsExpandedPending = false;
    void loadIdentity();
  }
  updateStats();
}

async function init(): Promise<void> {
  await loadIdentity();
  try {
    const bootstrap = await fetchMapResolved();
    if (bootstrap.data.tiles.length > 0) {
      applyMapSnapshot(bootstrap.data, bootstrap.meta);
    }
  } catch {
    // cache miss — live refresh below
  }
  await refreshMap();
  await loadFlags();
  if (UI_FEATURES.mapStream) {
    streamCatchingUp = true;
    subscribeMapStream(mapStreamUrl(), {
      onBatch: handleMapStreamBatch,
      onOffline: handleStreamOffline,
      onConnected: handleStreamConnected,
    });
  } else {
    streamCatchingUp = false;
    mapLive = false;
  }
  setInterval(() => void loadIdentity(), LEADERBOARD_POLL_MS);
  setInterval(() => void refreshMap(), MAP_SYNC_MS);
  setInterval(() => void loadFlags(), FLAGS_POLL_MS);
}

void init();
