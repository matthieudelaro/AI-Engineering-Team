/** @typedef {{ display_name: string; color: string; tile_count: number; flags_held: number; score: number }} LeaderboardEntry */
/** @typedef {{ x: number; y: number; ownership: string | { owned: string }; has_flag: boolean }} MapTile */
/** @typedef {{ bounds: { min_x: number; min_y: number; max_x: number; max_y: number }; tiles: MapTile[] }} MapView */
/** @typedef {{ entries: LeaderboardEntry[]; tick: number }} LeaderboardView */
/** @typedef {{ flag_id: string; x: number; y: number; pot: number; nuked: boolean; owner: string | null }} FlagView */

const POLL_MS = 750;
const PULSE_MS = 1200;
const FADE_MS = 600;
const POT_LABEL_MIN_TILE = 9;
const POT_HOVER_MIN_TILE = 6;

const EMPTY_COLOR = "#1a222c";
const NUKED_BASE = "#252d38";
const FLAG_UNCLAIMED = "#6b7d8f";

const params = new URLSearchParams(window.location.search);
const gameId = params.get("game_id") || "default";

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("map-canvas"));
const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
const gameIdLabel = /** @type {HTMLElement} */ (document.getElementById("game-id-label"));
const tickLabel = /** @type {HTMLElement} */ (document.getElementById("tick-label"));
const leaderboardEl = /** @type {HTMLElement} */ (document.getElementById("leaderboard"));
const statusEl = /** @type {HTMLElement} */ (document.getElementById("status"));

/** @type {Map<string, string>} */
const colorByName = new Map();
/** @type {Map<string, string>} */
const prevOwnerByCell = new Map();
/** @type {Map<string, { until: number; phase: number }>} */
const pulseByCell = new Map();
/** @type {Map<string, { until: number }>} */
const fadeByCell = new Map();

/** @type {FlagView[]} */
let currentFlags = [];
let flagsApiAvailable = false;
/** @type {FlagView | null} */
/** @type {string | null} cell key of hovered flag */
let hoverFlagKey = null;
/** @type {CanvasPattern | null} */
let nukedPattern = null;

let bounds = { min_x: -5, min_y: -5, max_x: 5, max_y: 5 };
let tileSize = 12;
let offsetX = 0;
let offsetY = 0;
let animFrame = 0;
let pollTimer = 0;
let statusTimer = 0;

gameIdLabel.textContent = `game ${gameId}`;

function cellKey(x, y) {
  return `${x},${y}`;
}

function ownerKey(ownership) {
  if (ownership === "nuked") return "__nuked__";
  if (ownership === "" || ownership == null) return "";
  if (typeof ownership === "object" && ownership.owned) return ownership.owned;
  return String(ownership);
}

function tileColor(ownership) {
  const key = ownerKey(ownership);
  if (key === "__nuked__") return NUKED_BASE;
  if (!key) return EMPTY_COLOR;
  return colorByName.get(key) ?? "#4a5568";
}

function ownerColor(name) {
  if (!name) return FLAG_UNCLAIMED;
  return colorByName.get(name) ?? "#4a5568";
}

function createNukedPattern() {
  const size = 8;
  const patternCanvas = document.createElement("canvas");
  patternCanvas.width = size;
  patternCanvas.height = size;
  const pCtx = patternCanvas.getContext("2d");
  if (!pCtx) return null;
  pCtx.fillStyle = NUKED_BASE;
  pCtx.fillRect(0, 0, size, size);
  pCtx.strokeStyle = "#3d4654";
  pCtx.lineWidth = 1;
  pCtx.beginPath();
  pCtx.moveTo(0, size);
  pCtx.lineTo(size, 0);
  pCtx.moveTo(-size / 2, size / 2);
  pCtx.lineTo(size / 2, -size / 2);
  pCtx.moveTo(size / 2, size + size / 2);
  pCtx.lineTo(size + size / 2, size / 2);
  pCtx.stroke();
  pCtx.strokeStyle = "#1a1f26";
  pCtx.beginPath();
  pCtx.moveTo(0, 0);
  pCtx.lineTo(size, size);
  pCtx.stroke();
  return ctx.createPattern(patternCanvas, "repeat");
}

function showStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.add("status--visible");
  statusEl.classList.toggle("status--error", isError);
  window.clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => {
    statusEl.classList.remove("status--visible");
  }, 2800);
}

function resizeCanvas() {
  const stage = canvas.parentElement;
  if (!stage) return;
  const dpr = window.devicePixelRatio || 1;
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  nukedPattern = createNukedPattern();
  fitCamera();
}

function fitCamera() {
  const stage = canvas.parentElement;
  if (!stage) return;
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  const gridW = bounds.max_x - bounds.min_x + 1;
  const gridH = bounds.max_y - bounds.min_y + 1;
  const pad = 24;
  tileSize = Math.max(4, Math.min((w - pad * 2) / gridW, (h - pad * 2) / gridH));
  const mapPxW = gridW * tileSize;
  const mapPxH = gridH * tileSize;
  offsetX = (w - mapPxW) / 2 - bounds.min_x * tileSize;
  offsetY = (h - mapPxH) / 2 - bounds.min_y * tileSize;
}

function tileToScreen(x, y) {
  return {
    sx: offsetX + x * tileSize,
    sy: offsetY + y * tileSize,
  };
}

function screenToTile(mx, my) {
  const x = Math.floor((mx - offsetX) / tileSize);
  const y = Math.floor((my - offsetY) / tileSize);
  if (x < bounds.min_x || x > bounds.max_x || y < bounds.min_y || y > bounds.max_y) {
    return null;
  }
  return { x, y };
}

function findFlagAt(mx, my) {
  const tile = screenToTile(mx, my);
  if (!tile) return null;
  const key = cellKey(tile.x, tile.y);
  for (const flag of currentFlags) {
    if (cellKey(flag.x, flag.y) === key) return flag;
  }
  return null;
}

function renderLeaderboard(view) {
  colorByName.clear();
  for (const entry of view.entries) {
    colorByName.set(entry.display_name, entry.color);
  }

  if (view.entries.length === 0) {
    leaderboardEl.innerHTML =
      '<p class="leaderboard__empty">No players yet — waiting for claims…</p>';
    return;
  }

  leaderboardEl.innerHTML = view.entries
    .map((e) => {
      const flagsHeld = e.flags_held ?? 0;
      return `
    <div class="leaderboard__entry">
      <span class="leaderboard__swatch" style="background:${e.color}"></span>
      <span class="leaderboard__name">${escapeHtml(e.display_name)}</span>
      <span class="leaderboard__stats">${e.tile_count} tiles · ${flagsHeld} flags · ${e.score} pts</span>
    </div>`;
    })
    .join("");
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildFlagsFromMap(map) {
  /** @type {FlagView[]} */
  const flags = [];
  for (const tile of map.tiles) {
    if (!tile.has_flag) continue;
    const owner = ownerKey(tile.ownership);
    flags.push({
      flag_id: cellKey(tile.x, tile.y),
      x: tile.x,
      y: tile.y,
      pot: -1,
      nuked: false,
      owner: owner && owner !== "__nuked__" ? owner : null,
    });
  }
  return flags;
}

function applyFlags(flags, fromApi) {
  currentFlags = flags;
  flagsApiAvailable = fromApi;
}

function applyMapDiff(map) {
  const now = performance.now();
  bounds = map.bounds;
  fitCamera();

  for (const tile of map.tiles) {
    const key = cellKey(tile.x, tile.y);
    const next = ownerKey(tile.ownership);
    const prev = prevOwnerByCell.get(key);
    if (prev !== undefined && prev !== next) {
      pulseByCell.set(key, { until: now + PULSE_MS, phase: 0 });
    }
    if (!prevOwnerByCell.has(key)) {
      fadeByCell.set(key, { until: now + FADE_MS });
    }
    prevOwnerByCell.set(key, next);
  }

  if (!flagsApiAvailable) {
    applyFlags(buildFlagsFromMap(map), false);
  }
}

function cellFadeAlpha(key, now) {
  const fade = fadeByCell.get(key);
  if (!fade) return 1;
  const t = 1 - (fade.until - now) / FADE_MS;
  const alpha = Math.min(1, Math.max(0.15, t));
  if (now >= fade.until) fadeByCell.delete(key);
  return alpha;
}

function drawNukedPattern(sx, sy, alpha) {
  if (!nukedPattern) return;
  ctx.globalAlpha = alpha * 0.9;
  ctx.fillStyle = nukedPattern;
  ctx.fillRect(sx + 0.5, sy + 0.5, tileSize - 1, tileSize - 1);
}

function drawClaimPulse(sx, sy, key, now) {
  const pulse = pulseByCell.get(key);
  if (!pulse) return;
  const remaining = pulse.until - now;
  if (remaining <= 0) {
    pulseByCell.delete(key);
    return;
  }
  const glow = 0.35 + 0.25 * Math.sin((1 - remaining / PULSE_MS) * Math.PI);
  ctx.globalAlpha = glow;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(sx + 0.5, sy + 0.5, tileSize - 1, tileSize - 1);
}

function potLabel(flag, hovered) {
  if (flag.pot >= 0) return String(flag.pot);
  if (hovered) return "?";
  return null;
}

function shouldShowPot(flag, hovered) {
  const label = potLabel(flag, hovered);
  if (!label) return false;
  if (tileSize >= POT_LABEL_MIN_TILE) return true;
  if (hovered && tileSize >= POT_HOVER_MIN_TILE) return true;
  if (tileSize >= 7 && flag.pot >= 8) return true;
  return false;
}

function drawFlagMarker(flag, now) {
  const { sx, sy } = tileToScreen(flag.x, flag.y);
  const key = cellKey(flag.x, flag.y);
  const alpha = cellFadeAlpha(key, now);
  const half = tileSize / 2;
  const cx = sx + half;
  const cy = sy + half;
  const hovered = hoverFlagKey === key;
  const color = ownerColor(flag.owner);
  const markerAlpha = flag.nuked ? alpha * 0.55 : alpha;
  const ringR = Math.max(2, Math.min(half - 1.5, tileSize * 0.38));

  ctx.globalAlpha = markerAlpha;

  if (flag.nuked) {
    ctx.beginPath();
    ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, tileSize * 0.12);
    ctx.setLineDash([2, 2]);
    ctx.stroke();
    ctx.setLineDash([]);
    const xR = ringR * 0.65;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, tileSize * 0.1);
    ctx.beginPath();
    ctx.moveTo(cx - xR, cy - xR);
    ctx.lineTo(cx + xR, cy + xR);
    ctx.moveTo(cx + xR, cy - xR);
    ctx.lineTo(cx - xR, cy + xR);
    ctx.stroke();
  } else if (flag.owner) {
    ctx.beginPath();
    ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.5, tileSize * 0.14);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
    ctx.strokeStyle = FLAG_UNCLAIMED;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  const d = Math.max(1.5, Math.min(half * 0.42, tileSize * 0.28));
  ctx.fillStyle = flag.owner ? color : FLAG_UNCLAIMED;
  ctx.beginPath();
  ctx.moveTo(cx, cy - d);
  ctx.lineTo(cx + d, cy);
  ctx.lineTo(cx, cy + d);
  ctx.lineTo(cx - d, cy);
  ctx.closePath();
  ctx.fill();

  if (tileSize >= 7) {
    const poleW = Math.max(1, tileSize * 0.1);
    const poleH = Math.max(2, tileSize * 0.35);
    ctx.fillStyle = "#c8d4e0";
    ctx.fillRect(cx - poleW / 2, cy - poleH, poleW, poleH);
  }

  const label = shouldShowPot(flag, hovered) ? potLabel(flag, hovered) : null;
  if (label) {
    const fontSize = Math.max(7, Math.min(11, tileSize * 0.42));
    ctx.font = `${fontSize}px "IBM Plex Mono", monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = flag.nuked ? "#9aa8b8" : "#d8e2ec";
    ctx.globalAlpha = markerAlpha;
    ctx.fillText(label, cx, sy + tileSize - fontSize - 1);
  }

  ctx.globalAlpha = 1;
}

function drawFrame() {
  const stage = canvas.parentElement;
  if (!stage) return;
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  const now = performance.now();

  ctx.clearRect(0, 0, w, h);

  for (const [key, prev] of prevOwnerByCell) {
    const [xs, ys] = key.split(",");
    const x = Number(xs);
    const y = Number(ys);
    const { sx, sy } = tileToScreen(x, y);
    const isNuked = prev === "__nuked__";
    const alpha = cellFadeAlpha(key, now);

    ctx.globalAlpha = alpha;
    if (isNuked) {
      ctx.fillStyle = NUKED_BASE;
    } else {
      const ownership = prev ? { owned: prev } : "";
      ctx.fillStyle = tileColor(ownership);
    }
    ctx.fillRect(sx + 0.5, sy + 0.5, tileSize - 1, tileSize - 1);
  }

  for (const [key, prev] of prevOwnerByCell) {
    if (prev !== "__nuked__") continue;
    const [xs, ys] = key.split(",");
    const x = Number(xs);
    const y = Number(ys);
    const { sx, sy } = tileToScreen(x, y);
    drawNukedPattern(sx, sy, cellFadeAlpha(key, now));
  }

  for (const [key, prev] of prevOwnerByCell) {
    const [xs, ys] = key.split(",");
    const x = Number(xs);
    const y = Number(ys);
    const { sx, sy } = tileToScreen(x, y);
    ctx.globalAlpha = cellFadeAlpha(key, now);
    drawClaimPulse(sx, sy, key, now);
  }

  for (const flag of currentFlags) {
    drawFlagMarker(flag, now);
  }

  ctx.globalAlpha = 1;
  animFrame = requestAnimationFrame(drawFrame);
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function fetchFlagsOptional() {
  try {
    const res = await fetch(
      `/api/v1/spectator/flags?game_id=${encodeURIComponent(gameId)}`,
    );
    if (!res.ok) return false;
    const data = /** @type {{ flags: FlagView[] }} */ (await res.json());
    applyFlags(data.flags ?? [], true);
    return true;
  } catch {
    return false;
  }
}

async function poll() {
  try {
    const [map, leaderboard] = await Promise.all([
      fetchJson(`/api/v1/spectator/map?game_id=${encodeURIComponent(gameId)}`),
      fetchJson(`/api/v1/spectator/leaderboard?game_id=${encodeURIComponent(gameId)}`),
      fetchFlagsOptional(),
    ]);
    applyMapDiff(/** @type {MapView} */ (map));
    renderLeaderboard(/** @type {LeaderboardView} */ (leaderboard));
    tickLabel.textContent = `tick ${leaderboard.tick}`;
    statusEl.classList.remove("status--error");
  } catch (err) {
    showStatus(`Connection lost — retrying…`, true);
    console.error(err);
  }
}

function start() {
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);
  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const flag = findFlagAt(e.clientX - rect.left, e.clientY - rect.top);
    hoverFlagKey = flag ? cellKey(flag.x, flag.y) : null;
  });
  canvas.addEventListener("mouseleave", () => {
    hoverFlagKey = null;
  });
  drawFrame();
  poll();
  pollTimer = window.setInterval(poll, POLL_MS);
}

start();
