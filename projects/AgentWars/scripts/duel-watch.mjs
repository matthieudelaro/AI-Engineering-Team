#!/usr/bin/env node
/**
 * Watch spectator map until two size expansions or MAX_MS (default 3 min).
 * Usage: node scripts/duel-watch.mjs [gameId]
 */
const BASE = process.env.GAME_API_URL ?? "http://127.0.0.1:8000";
const GAME = process.argv[2] ?? process.env.GAME_ID ?? "qa1";
const MAX_MS = Number(process.env.MAX_MS ?? 180_000);
const NEED_EXPANDS = Number(process.env.NEED_EXPANDS ?? 2);

function sizeOf(bounds) {
  return {
    w: bounds.max_x - bounds.min_x + 1,
    h: bounds.max_y - bounds.min_y + 1,
  };
}

async function snapshot() {
  const r = await fetch(
    `${BASE}/api/v1/spectator/map?game_id=${encodeURIComponent(GAME)}`,
  );
  if (r.status === 404) return null;
  const map = await r.json();
  const lb = await fetch(
    `${BASE}/api/v1/spectator/leaderboard?game_id=${encodeURIComponent(GAME)}`,
  ).then((x) => x.json());
  return { map, lb };
}

const started = Date.now();
let first = await snapshot();
while (!first && Date.now() - started < 10_000) {
  await new Promise((r) => setTimeout(r, 500));
  first = await snapshot();
}
if (!first) {
  console.error("[duel-watch] no game", GAME);
  process.exit(1);
}

let { w: lastW, h: lastH } = sizeOf(first.map.bounds);
let expands = 0;
console.log(
  `[duel-watch] start size=${lastW}x${lastH} need=${NEED_EXPANDS} maxMs=${MAX_MS}`,
  first.lb.entries?.map((e) => `${e.display_name}:${e.tile_count}`).join(" "),
);

while (Date.now() - started < MAX_MS && expands < NEED_EXPANDS) {
  await new Promise((r) => setTimeout(r, 1000));
  const snap = await snapshot();
  if (!snap) continue;
  const { w, h } = sizeOf(snap.map.bounds);
  if (w > lastW || h > lastH) {
    expands += 1;
    console.log(
      `[duel-watch] EXPAND #${expands}: ${lastW}x${lastH} → ${w}x${h} t=${((Date.now() - started) / 1000).toFixed(1)}s`,
      snap.lb.entries?.map((e) => `${e.display_name}:${e.tile_count}`).join(" "),
    );
    lastW = w;
    lastH = h;
  } else if ((Date.now() - started) % 15000 < 1100) {
    console.log(
      `[duel-watch] t=${((Date.now() - started) / 1000).toFixed(0)}s size=${w}x${h} expands=${expands}`,
      snap.lb.entries?.map((e) => `${e.display_name}:${e.tile_count}`).join(" "),
    );
  }
}

const final = await snapshot();
const reason =
  expands >= NEED_EXPANDS ? "reached_expands" : "timeout";
console.log(
  `[duel-watch] done reason=${reason} expands=${expands} size=${final ? sizeOf(final.map.bounds).w : "?"}x${final ? sizeOf(final.map.bounds).h : "?"} elapsedMs=${Date.now() - started}`,
);
console.log(
  "[duel-watch] leaderboard",
  JSON.stringify(final?.lb?.entries ?? [], null, 0),
);
process.exit(expands >= NEED_EXPANDS ? 0 : 2);
