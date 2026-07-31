/** @typedef {{ display_name: string; color: string; tile_count: number; flags_held: number; score: number }} LeaderboardEntry */
/** @typedef {{ x: number; y: number; ownership: string | { owned: string }; has_flag: boolean }} MapTile */
/** @typedef {{ bounds: { min_x: number; min_y: number; max_x: number; max_y: number }; tiles: MapTile[] }} MapView */
/** @typedef {{ entries: LeaderboardEntry[]; tick: number }} LeaderboardView */

const POLL_MS = 750;
const PULSE_MS = 1200;
const FADE_MS = 600;

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
/** @type {Map<string, number>} */
const ownerKeyByName = new Map();
/** @type {Map<string, string>} */
const prevOwnerByCell = new Map();
/** @type {Map<string, { until: number; phase: number }>} */
const pulseByCell = new Map();
/** @type {Map<string, { until: number }>} */
const fadeByCell = new Map();

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
  if (key === "__nuked__") return "#2a3038";
  if (!key) return "#1a222c";
  return colorByName.get(key) ?? "#4a5568";
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
    .map(
      (e) => `
    <div class="leaderboard__entry">
      <span class="leaderboard__swatch" style="background:${e.color}"></span>
      <span class="leaderboard__name">${escapeHtml(e.display_name)}</span>
      <span class="leaderboard__stats">${e.tile_count} tiles · ${e.score} pts</span>
    </div>`,
    )
    .join("");
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
    ownerKeyByName.set(next, next);
  }
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
    const ownership = prev === "__nuked__" ? "nuked" : prev ? { owned: prev } : "";
    const base = tileColor(ownership);

    let alpha = 1;
    const fade = fadeByCell.get(key);
    if (fade) {
      const t = 1 - (fade.until - now) / FADE_MS;
      alpha = Math.min(1, Math.max(0.15, t));
      if (now >= fade.until) fadeByCell.delete(key);
    }

    let glow = 0;
    const pulse = pulseByCell.get(key);
    if (pulse) {
      const remaining = pulse.until - now;
      if (remaining > 0) {
        glow = 0.35 + 0.25 * Math.sin((1 - remaining / PULSE_MS) * Math.PI);
      } else {
        pulseByCell.delete(key);
      }
    }

    ctx.globalAlpha = alpha;
    ctx.fillStyle = base;
    ctx.fillRect(sx + 0.5, sy + 0.5, tileSize - 1, tileSize - 1);

    if (glow > 0) {
      ctx.globalAlpha = glow;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(sx + 0.5, sy + 0.5, tileSize - 1, tileSize - 1);
    }
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

async function poll() {
  try {
    const [map, leaderboard] = await Promise.all([
      fetchJson(`/api/v1/spectator/map?game_id=${encodeURIComponent(gameId)}`),
      fetchJson(`/api/v1/spectator/leaderboard?game_id=${encodeURIComponent(gameId)}`),
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
  drawFrame();
  poll();
  pollTimer = window.setInterval(poll, POLL_MS);
}

start();
