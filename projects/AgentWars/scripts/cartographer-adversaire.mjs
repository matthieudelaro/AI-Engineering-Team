#!/usr/bin/env node
/**
 * cartographer-adversaire — flag-hungry defensive bot for local matches.
 *
 * Grows toward high-pot flags, nukes threatened owned flags, and once per
 * minute nukes one of its own flags to open the cartographer attack window.
 *
 * Usage:
 *   node scripts/cartographer-adversaire.mjs [gameId]
 * Env:
 *   GAME_API_URL (default http://127.0.0.1:8000)
 *   PLAYER_ID    (default cartographer-adversaire)
 *   RPS          (default 18)
 *   MAX_MS       (default 300000)
 *   NUKE_EVERY_MS (default 60000) — scheduled self-flag nuke interval
 */
const BASE = process.env.GAME_API_URL ?? "http://127.0.0.1:8000";
const GAME = process.argv[2] ?? process.env.GAME_ID ?? "live5m";
const PLAYER = process.env.PLAYER_ID ?? "cartographer-adversaire";
const RPS = Number(process.env.RPS ?? 18);
const MAX_MS = Number(process.env.MAX_MS ?? 300_000);
const NUKE_EVERY_MS = Number(process.env.NUKE_EVERY_MS ?? 60_000);
const unlimited = !Number.isFinite(MAX_MS) || MAX_MS <= 0;

const CARDINALS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];

let bounds = { min_x: -5, min_y: -5, max_x: 5, max_y: 5 };
/** @type {Map<string, string>} cell → owner display name or "nuked" */
let ownership = new Map();
/** @type {Array<{ flag_id: string; x: number; y: number; pot: number; nuked: boolean; owner: string | null }>} */
let flags = [];
let accepted = 0;
let rejected = 0;
let nukes = 0;
let running = true;
let lastNukeAt = 0;
let lastScheduledNukeAt = 0;
const NUKE_COOLDOWN_MS = 30_000;

function cellKey(x, y) {
  return `${x},${y}`;
}

function ownerOf(x, y) {
  return ownership.get(cellKey(x, y)) ?? null;
}

function ownedList() {
  /** @type {Array<{ x: number; y: number }>} */
  const out = [];
  for (const [key, owner] of ownership) {
    if (owner !== PLAYER) continue;
    const [xs, ys] = key.split(",");
    out.push({ x: Number(xs), y: Number(ys) });
  }
  return out;
}

async function refreshState() {
  try {
    const [mapRes, flagsRes] = await Promise.all([
      fetch(`${BASE}/api/v1/spectator/map?game_id=${encodeURIComponent(GAME)}`),
      fetch(
        `${BASE}/api/v1/spectator/flags?game_id=${encodeURIComponent(GAME)}`,
      ),
    ]);
    if (mapRes.ok) {
      const map = await mapRes.json();
      if (map?.bounds) bounds = map.bounds;
      ownership = new Map();
      for (const tile of map.tiles ?? []) {
        if (tile.ownership === "nuked") {
          ownership.set(cellKey(tile.x, tile.y), "nuked");
        } else if (tile.ownership?.owned) {
          ownership.set(cellKey(tile.x, tile.y), tile.ownership.owned);
        }
      }
    }
    if (flagsRes.ok) {
      const body = await flagsRes.json();
      flags = body.flags ?? [];
    }
  } catch {
    // ignore transient errors
  }
}

async function placeTile(x, y) {
  try {
    const r = await fetch(`${BASE}/api/v1/place-tile`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Player-Id": PLAYER,
      },
      body: JSON.stringify({ game_id: GAME, x, y }),
    });
    const j = await r.json().catch(() => ({}));
    if (j?.accepted) {
      accepted += 1;
      ownership.set(cellKey(x, y), PLAYER);
      return true;
    }
    rejected += 1;
  } catch {
    rejected += 1;
  }
  return false;
}

async function launchNuke(x, y) {
  const now = Date.now();
  if (now - lastNukeAt < NUKE_COOLDOWN_MS) return false;
  try {
    const r = await fetch(`${BASE}/api/v1/launch-nuke`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Player-Id": PLAYER,
      },
      body: JSON.stringify({ game_id: GAME, x, y }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && !j?.rejected) {
      nukes += 1;
      lastNukeAt = now;
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

function inBounds(x, y) {
  return (
    x >= bounds.min_x &&
    x <= bounds.max_x &&
    y >= bounds.min_y &&
    y <= bounds.max_y
  );
}

function flagPriority(f) {
  const owned = ownedList();
  const dist =
    owned.length === 0
      ? Math.abs(f.x) + Math.abs(f.y)
      : Math.min(
          ...owned.map((p) => Math.abs(p.x - f.x) + Math.abs(p.y - f.y)),
        );
  return f.pot * 10 - dist;
}

function pickGrowTarget() {
  const owned = ownedList();
  if (owned.length === 0) {
    // Bootstrap near origin so we exist on the starter 11×11.
    return { x: -2, y: -2 };
  }
  /** @type {Array<{ x: number; y: number }>} */
  const empty = [];
  /** @type {Array<{ x: number; y: number }>} */
  const enemy = [];
  const sample = owned.length <= 120 ? owned : owned.slice(0, 120);
  for (const p of sample) {
    for (const { dx, dy } of CARDINALS) {
      const x = p.x + dx;
      const y = p.y + dy;
      if (!inBounds(x, y)) continue;
      const o = ownerOf(x, y);
      if (o === "nuked" || o === PLAYER) continue;
      if (o === null) empty.push({ x, y });
      else enemy.push({ x, y });
    }
  }
  const pool = empty.length > 0 ? empty : enemy;
  if (pool.length === 0) {
    const x =
      bounds.min_x +
      Math.floor(Math.random() * (bounds.max_x - bounds.min_x + 1));
    const y =
      bounds.min_y +
      Math.floor(Math.random() * (bounds.max_y - bounds.min_y + 1));
    return { x, y };
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

function stepToward(from, to) {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  // Prefer the axis with larger remaining distance.
  if (Math.abs(to.x - from.x) >= Math.abs(to.y - from.y) && dx !== 0) {
    return { x: from.x + dx, y: from.y };
  }
  if (dy !== 0) return { x: from.x, y: from.y + dy };
  if (dx !== 0) return { x: from.x + dx, y: from.y };
  return null;
}

/** Prefer nuking the lowest-pot owned flag so juicier ones remain stealable. */
function pickOwnedFlagToNuke() {
  /** @type {{ flag_id: string; x: number; y: number; pot: number } | null} */
  let best = null;
  for (const f of flags) {
    if (f.nuked) continue;
    if (ownerOf(f.x, f.y) !== PLAYER) continue;
    if (!best || f.pot < best.pot) best = f;
  }
  return best;
}

async function tick() {
  const now = Date.now();
  const activeFlags = flags
    .filter((f) => !f.nuked)
    .sort((a, b) => flagPriority(b) - flagPriority(a));

  // 0) Scheduled self-flag nuke (~1/min) to open cartographer's attack window.
  if (
    now - lastScheduledNukeAt >= NUKE_EVERY_MS &&
    now - lastNukeAt >= NUKE_COOLDOWN_MS
  ) {
    const target = pickOwnedFlagToNuke();
    if (target) {
      if (await launchNuke(target.x, target.y)) {
        lastScheduledNukeAt = now;
        console.log(
          `[cartographer-adversaire] scheduled nuke flag=${target.flag_id} pot=${target.pot}`,
        );
        return;
      }
    }
  }

  // 1) Defensive nuke on threatened owned flags.
  for (const f of activeFlags) {
    const owner = ownerOf(f.x, f.y);
    if (owner !== PLAYER) continue;
    let threatened = false;
    for (const { dx, dy } of CARDINALS) {
      const o = ownerOf(f.x + dx, f.y + dy);
      if (o && o !== PLAYER && o !== "nuked") {
        threatened = true;
        break;
      }
    }
    if (threatened && now - lastNukeAt >= NUKE_COOLDOWN_MS) {
      if (await launchNuke(f.x, f.y)) return;
    }
  }

  // 2) March toward / claim nearest valuable flag.
  const owned = ownedList();
  for (const f of activeFlags) {
    const owner = ownerOf(f.x, f.y);
    if (owner === PLAYER || owner === "nuked") continue;
    if (owned.length === 0) break;
    const nearest = owned.reduce((best, p) => {
      const d = Math.abs(p.x - f.x) + Math.abs(p.y - f.y);
      return d < best.d ? { p, d } : best;
    }, /** @type {{ p: { x: number; y: number }; d: number }} */ ({ p: owned[0], d: Infinity }));

    if (nearest.d <= 1) {
      await placeTile(f.x, f.y);
      return;
    }
    // Only chase flags within a reasonable distance of territory.
    if (nearest.d > 25) continue;
    const step = stepToward(nearest.p, { x: f.x, y: f.y });
    if (step && inBounds(step.x, step.y) && ownerOf(step.x, step.y) !== "nuked") {
      await placeTile(step.x, step.y);
      return;
    }
  }

  // 3) Generic growth.
  const target = pickGrowTarget();
  await placeTile(target.x, target.y);
}

const started = Date.now();
await refreshState();
console.log(
  `[cartographer-adversaire] game=${GAME} player=${PLAYER} rps=${RPS} bounds=`,
  bounds,
);

const stateTimer = setInterval(() => {
  void refreshState();
}, 1000);

const statsTimer = setInterval(() => {
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `[cartographer-adversaire] t=${elapsed}s accepted=${accepted} rejected=${rejected} nukes=${nukes} tiles=${ownedList().length} flags=${flags.length}`,
  );
}, 5000);

const intervalMs = 1000 / RPS;
async function loop() {
  while (running && (unlimited || Date.now() - started < MAX_MS)) {
    const t0 = Date.now();
    await tick();
    const wait = intervalMs - (Date.now() - t0);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
}

process.on("SIGINT", () => {
  running = false;
});
process.on("SIGTERM", () => {
  running = false;
});

await loop();
clearInterval(stateTimer);
clearInterval(statsTimer);
console.log(
  `[cartographer-adversaire] done accepted=${accepted} rejected=${rejected} nukes=${nukes}`,
);
process.exit(0);
