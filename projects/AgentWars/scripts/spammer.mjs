#!/usr/bin/env node
/**
 * Spammer — stupid opponent: burns ~20 place-tile/s on random in-bounds cells.
 *
 * Usage:
 *   node scripts/spammer.mjs [gameId]
 * Env:
 *   GAME_API_URL (default http://127.0.0.1:8000)
 *   PLAYER_ID    (default Spammer)
 *   RPS          (default 20)
 *   MAX_MS       (default 180000) hard stop
 */
const BASE = process.env.GAME_API_URL ?? "http://127.0.0.1:8000";
const GAME = process.argv[2] ?? process.env.GAME_ID ?? "qa1";
const PLAYER = process.env.PLAYER_ID ?? "Spammer";
const RPS = Number(process.env.RPS ?? 20);
/** 0 or negative = run until SIGINT/SIGTERM (default 3 minutes). */
const MAX_MS = Number(process.env.MAX_MS ?? 180_000);
const unlimited = !Number.isFinite(MAX_MS) || MAX_MS <= 0;

let bounds = { min_x: -5, min_y: -5, max_x: 5, max_y: 5 };
let accepted = 0;
let rejected = 0;
let limited = 0;
let running = true;

async function refreshBounds() {
  // Prefer omniscient spectator bounds — fogged /map collapses when Spammer
  // owns few tiles and traps random claims in a tiny pocket.
  try {
    const r = await fetch(
      `${BASE}/api/v1/spectator/map?game_id=${encodeURIComponent(GAME)}`,
    );
    if (r.ok) {
      const j = await r.json();
      if (j?.bounds) {
        bounds = j.bounds;
        return;
      }
    }
  } catch {
    // fall through
  }
  try {
    const r = await fetch(`${BASE}/api/v1/map?game_id=${encodeURIComponent(GAME)}`, {
      headers: { "X-Player-Id": PLAYER },
    });
    if (!r.ok) return;
    const j = await r.json();
    if (j?.bounds) bounds = j.bounds;
  } catch {
    // ignore
  }
}

function randomCell() {
  const x =
    bounds.min_x + Math.floor(Math.random() * (bounds.max_x - bounds.min_x + 1));
  const y =
    bounds.min_y + Math.floor(Math.random() * (bounds.max_y - bounds.min_y + 1));
  return { x, y };
}

async function claimOnce() {
  const { x, y } = randomCell();
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
    if (r.status === 429 || j?.rejected?.reason?.includes("RATE")) {
      limited += 1;
      return;
    }
    if (j?.accepted) accepted += 1;
    else rejected += 1;
  } catch {
    rejected += 1;
  }
}

const started = Date.now();
await refreshBounds();
console.log(`[spammer] game=${GAME} player=${PLAYER} rps=${RPS} bounds=`, bounds);

const boundTimer = setInterval(() => {
  void refreshBounds();
}, 2000);

const statsTimer = setInterval(() => {
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `[spammer] t=${elapsed}s accepted=${accepted} rejected=${rejected} limited=${limited} bounds=${bounds.min_x}..${bounds.max_x}x${bounds.min_y}..${bounds.max_y}`,
  );
}, 5000);

const intervalMs = 1000 / RPS;
async function loop() {
  while (running && (unlimited || Date.now() - started < MAX_MS)) {
    const t0 = Date.now();
    // fire without awaiting previous fully — keep pipeline short (1 in flight avg)
    void claimOnce();
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
clearInterval(boundTimer);
clearInterval(statsTimer);
console.log(
  `[spammer] done accepted=${accepted} rejected=${rejected} limited=${limited}`,
);
process.exit(0);
