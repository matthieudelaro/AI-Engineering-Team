import "./style.css";
import {
  bindRateBudget,
  fetchLeaderboard,
  fetchMap,
  formatCacheAge,
  ownershipColor,
  ownershipName,
  placeTile,
} from "./api.js";
import { buildPlayerColors, mapColorForPlayer } from "./playerColors.js";
import { initMapZoom } from "./mapZoom.js";
import { initApiConsole } from "./apiConsole.js";
import { initRatePanel } from "./ratePanel.js";
import { ClaimQueue } from "./claimQueue.js";
import { RateBudget } from "./rateBudget.js";
import type { BoundBox, LeaderboardEntry, MapResponse, PlayerColors, Tile } from "./types.js";

const MAP_POLL_MS = 5000;
const LEADERBOARD_POLL_MS = 3000;
/** Manual click-drag claims — no artificial throttle. */
const CLAIM_INTERVAL_MS = 0;

const statsEl = document.getElementById("stats");
const statusEl = document.getElementById("status");
const boardEl = document.getElementById("board");
const boardViewportEl = document.getElementById("board-viewport");
const leaderboardEl = document.getElementById("leaderboard");
const apiConsoleEl = document.getElementById("api-console");
const ratePanelEl = document.getElementById("rate-panel");

if (!statsEl || !statusEl || !boardEl || !boardViewportEl || !leaderboardEl || !apiConsoleEl || !ratePanelEl) {
  throw new Error("missing DOM elements");
}

const mapZoom = initMapZoom(boardViewportEl, boardEl);

initApiConsole(apiConsoleEl);
initRatePanel(ratePanelEl);

const rateBudget = new RateBudget();
bindRateBudget(rateBudget);

let playerColors: PlayerColors = {
  selfName: null,
  selfColor: "#ff2d95",
  byName: new Map(),
};

let latestMap: MapResponse | null = null;
let latestLeaderboard: LeaderboardEntry[] = [];
let mapCacheAge = "";
let leaderboardCacheAge = "";
let lastBounds: BoundBox | null = null;
let painting = false;
const tileIndex = new Map<string, Tile>();
const pendingCells = new Set<string>();

const claimQueue = new ClaimQueue((x, y) => {
  void sendClaim(x, y);
}, CLAIM_INTERVAL_MS);

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function setStatus(message: string): void {
  statusEl.textContent = message;
}

function updateStats(): void {
  if (!latestMap) {
    statsEl.textContent = "Waiting for map…";
    return;
  }
  const selfTiles = [...tileIndex.values()].filter(
    (t) => ownershipName(t.ownership) === playerColors.selfName,
  ).length;
  const total = latestMap.tiles.length;
  const name = playerColors.selfName ?? "you";
  statsEl.textContent = `${name}: ${selfTiles} tiles · map shows ${total} claimed · ${rateBudget.label()} · reads from DB (map ${mapCacheAge}, lb ${leaderboardCacheAge}) · bounds (${latestMap.bounds.min_x}…${latestMap.bounds.max_x}, ${latestMap.bounds.min_y}…${latestMap.bounds.max_y})`;
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
    const resolved = buildPlayerColors(leaderboard.entries);
    playerColors.selfName = resolved.selfName;
    playerColors.selfColor = resolved.selfColor;
    playerColors.byName.clear();
    for (const [name, color] of resolved.byName) {
      playerColors.byName.set(name, color);
    }
    renderLeaderboard(latestLeaderboard);
    if (latestMap && !painting) {
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
  return ownershipColor(tile.ownership, playerColors) ?? "#5b6b82";
}

function renderBoard(map: MapResponse): void {
  const { min_x, min_y, max_x, max_y } = map.bounds;
  const width = max_x - min_x + 1;
  const height = max_y - min_y + 1;

  boardEl.style.gridTemplateColumns = `repeat(${width}, 14px)`;
  boardEl.replaceChildren();

  for (let y = min_y; y <= max_y; y++) {
    for (let x = min_x; x <= max_x; x++) {
      const tile = tileIndex.get(cellKey(x, y));
      const owner = tile ? ownershipName(tile.ownership) : null;
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.x = String(x);
      cell.dataset.y = String(y);
      cell.setAttribute("role", "gridcell");
      cell.title = tile?.has_flag
        ? `${owner ?? "unknown"} — flag (${x}, ${y})`
        : owner
          ? `${owner} (${x}, ${y})`
          : `empty (${x}, ${y})`;

      if (!owner) {
        cell.classList.add("empty");
      }
      if (owner === playerColors.selfName) {
        cell.classList.add("self");
      }
      if (tile?.has_flag) {
        cell.classList.add("flag");
      }
      if (pendingCells.has(cellKey(x, y))) {
        cell.classList.add("pending");
      }

      cell.style.backgroundColor = colorForTile(tile);
      boardEl.appendChild(cell);
    }
  }
}

function isOwnTile(x: number, y: number): boolean {
  const tile = tileIndex.get(cellKey(x, y));
  if (!tile) {
    return false;
  }
  return ownershipName(tile.ownership) === playerColors.selfName;
}

function markCellPending(x: number, y: number): void {
  const cell = boardEl.querySelector<HTMLElement>(
    `.cell[data-x="${x}"][data-y="${y}"]`,
  );
  cell?.classList.add("pending");
}

function tryClaim(x: number, y: number): void {
  if (playerColors.selfName === null) {
    return;
  }
  if (isOwnTile(x, y)) {
    return;
  }
  const k = cellKey(x, y);
  if (pendingCells.has(k)) {
    return;
  }
  pendingCells.add(k);
  claimQueue.enqueue(x, y);
  markCellPending(x, y);
}

async function sendClaim(x: number, y: number): Promise<void> {
  try {
    const result = await placeTile(x, y);
    if (result.rejected) {
      setStatus(`Rejected (${x},${y}): ${result.rejected.reason}`);
      pendingCells.delete(cellKey(x, y));
      claimQueue.unmarkOwned(x, y);
      if (result.rejected.retry_after) {
        await new Promise((r) => setTimeout(r, result.rejected!.retry_after! * 1000));
      }
    } else {
      setStatus("");
      claimQueue.markOwned(x, y);
    }
    updateStats();
  } catch (error) {
    const message = error instanceof Error ? error.message : "claim failed";
    setStatus(message);
    pendingCells.delete(cellKey(x, y));
    claimQueue.unmarkOwned(x, y);
  }
}

async function refreshMap(): Promise<void> {
  try {
    const { data: map, meta } = await fetchMap();
    mapCacheAge = formatCacheAge(meta.fetchedAt);
    const expanded =
      lastBounds !== null &&
      !boundsEqual(lastBounds, map.bounds) &&
      boundsExpanded(lastBounds, map.bounds);

    latestMap = map;
    rebuildTileIndex(map);
    claimQueue.clearClaimed();
    for (const tile of map.tiles) {
      if (ownershipName(tile.ownership) === playerColors.selfName) {
        claimQueue.markOwned(tile.x, tile.y);
      }
    }
    if (!painting) {
      pendingCells.clear();
      renderBoard(map);
    }
    updateStats();

    if (expanded) {
      await loadIdentity();
      setStatus(
        `Map expanded to (${map.bounds.min_x}…${map.bounds.max_x}, ${map.bounds.min_y}…${map.bounds.max_y})`,
      );
    } else {
      setStatus("");
    }

    lastBounds = { ...map.bounds };
  } catch (error) {
    const message = error instanceof Error ? error.message : "map error";
    boardEl.replaceChildren();
    const err = document.createElement("div");
    err.className = "board-error";
    err.textContent = `Cannot load map: ${message}`;
    boardEl.appendChild(err);
    setStatus(message);
  }
}

function cellFromPointer(event: PointerEvent): { x: number; y: number } | null {
  const target = document.elementFromPoint(event.clientX, event.clientY);
  return cellFromTarget(target);
}

function cellFromTarget(target: EventTarget | null): { x: number; y: number } | null {
  if (!(target instanceof HTMLElement)) {
    return null;
  }
  const cell = target.closest<HTMLElement>(".cell");
  if (!cell?.dataset.x || !cell.dataset.y) {
    return null;
  }
  return {
    x: Number.parseInt(cell.dataset.x, 10),
    y: Number.parseInt(cell.dataset.y, 10),
  };
}

function stopPainting(): void {
  if (!painting) {
    return;
  }
  painting = false;
  if (latestMap) {
    renderBoard(latestMap);
  }
}

boardEl.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || mapZoom.isPinching()) {
    return;
  }
  painting = true;
  boardEl.setPointerCapture(event.pointerId);
  const pos = cellFromPointer(event);
  if (pos) {
    tryClaim(pos.x, pos.y);
  }
});

boardEl.addEventListener("pointermove", (event) => {
  if (!painting || mapZoom.isPinching()) {
    return;
  }
  const pos = cellFromPointer(event);
  if (pos) {
    tryClaim(pos.x, pos.y);
  }
});

boardEl.addEventListener("pointerup", (event) => {
  if (boardEl.hasPointerCapture(event.pointerId)) {
    boardEl.releasePointerCapture(event.pointerId);
  }
  stopPainting();
});

boardEl.addEventListener("pointercancel", (event) => {
  if (boardEl.hasPointerCapture(event.pointerId)) {
    boardEl.releasePointerCapture(event.pointerId);
  }
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
  }
});

async function init(): Promise<void> {
  await loadIdentity();
  await refreshMap();
  setInterval(() => void loadIdentity(), LEADERBOARD_POLL_MS);
  setInterval(() => void refreshMap(), MAP_POLL_MS);
}

void init();
