#!/usr/bin/env tsx
/**
 * Multiplayer mock game API for local cartographer matches when the real
 * upstream (172.16.1.190) is unreachable.
 *
 * Simulates opponents "matthieu" (flag grabber + defensive nuke) and
 * "Spammer" (aggressive claim spam) alongside our player.
 *
 * Usage:
 *   npx tsx scripts/mock-game-api.ts
 *   GAME_API_URL=http://127.0.0.1:8000 npm run gateway
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const PORT = Number(process.env.MOCK_GAME_PORT ?? 8000);
const GAME_ID = process.env.GAME_ID ?? "mock5m";
const SELF_PLAYER_ID = process.env.PLAYER_ID ?? "remotematthieu999";
const SELF_NAME = process.env.SELF_DISPLAY_NAME ?? "RemoteMatthieu";
const HALF = Number(process.env.MOCK_MAP_HALF ?? 40);
const BOT_CLAIM_MS = Number(process.env.MOCK_BOT_CLAIM_MS ?? 70);

interface Tile {
  x: number;
  y: number;
  ownership: { owned: string } | "nuked";
}

interface Flag {
  flag_id: string;
  x: number;
  y: number;
  pot: number;
  nuked: boolean;
}

const bounds = {
  min_x: -HALF,
  min_y: -HALF,
  max_x: HALF,
  max_y: HALF,
};

const tiles = new Map<string, Tile>();
const flags: Flag[] = [
  { flag_id: "f-ne", x: 25, y: 25, pot: 40, nuked: false },
  { flag_id: "f-nw", x: -25, y: 25, pot: 35, nuked: false },
  { flag_id: "f-se", x: 25, y: -25, pot: 55, nuked: false },
  { flag_id: "f-sw", x: -25, y: -25, pot: 30, nuked: false },
  { flag_id: "f-c", x: 0, y: 0, pot: 80, nuked: false },
];

/** Last nuke time per display name (ms). */
const lastNukeAt = new Map<string, number>();
const NUKE_COOLDOWN_MS = 30_000;

const PLAYER_ID_TO_NAME: Record<string, string> = {
  [SELF_PLAYER_ID]: SELF_NAME,
  matthieu: "matthieu",
  Spammer: "Spammer",
};

function key(x: number, y: number): string {
  return `${x},${y}`;
}

function ownerOf(x: number, y: number): string | null {
  const t = tiles.get(key(x, y));
  if (!t) {
    return null;
  }
  if (t.ownership === "nuked") {
    return "nuked";
  }
  return t.ownership.owned;
}

function setOwner(x: number, y: number, name: string): void {
  tiles.set(key(x, y), { x, y, ownership: { owned: name } });
}

function nukeCell(x: number, y: number): void {
  tiles.set(key(x, y), { x, y, ownership: "nuked" });
  const f = flags.find((fl) => fl.x === x && fl.y === y);
  if (f) {
    f.nuked = true;
  }
}

function inBounds(x: number, y: number): boolean {
  return (
    x >= bounds.min_x &&
    x <= bounds.max_x &&
    y >= bounds.min_y &&
    y <= bounds.max_y
  );
}

function countTiles(name: string): number {
  let n = 0;
  for (const t of tiles.values()) {
    if (t.ownership !== "nuked" && t.ownership.owned === name) {
      n += 1;
    }
  }
  return n;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json",
    "x-ratelimit-remaining": "19",
    "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 1),
  });
  res.end(JSON.stringify(body));
}

function resolvePlayerName(req: IncomingMessage): string {
  const header = req.headers["x-player-id"];
  const id = typeof header === "string" ? header : SELF_PLAYER_ID;
  return PLAYER_ID_TO_NAME[id] ?? id;
}

function canNuke(name: string, nowMs: number): boolean {
  const last = lastNukeAt.get(name) ?? 0;
  return nowMs - last >= NUKE_COOLDOWN_MS;
}

function claimTile(name: string, x: number, y: number): boolean {
  if (!inBounds(x, y)) {
    return false;
  }
  const cur = ownerOf(x, y);
  if (cur === "nuked") {
    return false;
  }
  setOwner(x, y, name);
  return true;
}

/** Seed starting corners so each player has a foothold. */
function seedStarts(): void {
  // Self: larger origin foothold so we survive until the agent connects.
  for (let dx = -3; dx <= 3; dx++) {
    for (let dy = -3; dy <= 3; dy++) {
      setOwner(dx, dy, SELF_NAME);
    }
  }
  // matthieu: SW corner near flag (stay away from origin)
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      setOwner(-28 + dx, -28 + dy, "matthieu");
    }
  }
  // Spammer: NE corner
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      setOwner(28 + dx, 28 + dy, "Spammer");
    }
  }
}

function ownedList(name: string): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (const t of tiles.values()) {
    if (t.ownership !== "nuked" && t.ownership.owned === name) {
      out.push({ x: t.x, y: t.y });
    }
  }
  return out;
}

const CARDINALS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];

function botGrow(name: string): void {
  const owned = ownedList(name);
  if (owned.length === 0) {
    claimTile(name, 0, 0);
    return;
  }
  // Prefer empty neighbors, else enemy.
  const empty: Array<{ x: number; y: number }> = [];
  const enemy: Array<{ x: number; y: number }> = [];
  const sample = owned.length <= 80 ? owned : owned.slice(0, 80);
  for (const p of sample) {
    for (const { dx, dy } of CARDINALS) {
      const x = p.x + dx;
      const y = p.y + dy;
      if (!inBounds(x, y)) {
        continue;
      }
      const o = ownerOf(x, y);
      if (o === "nuked" || o === name) {
        continue;
      }
      if (o === null) {
        empty.push({ x, y });
      } else {
        enemy.push({ x, y });
      }
    }
  }
  const pool = empty.length > 0 ? empty : enemy;
  if (pool.length === 0) {
    // Random probe
    const x =
      bounds.min_x + Math.floor(Math.random() * (bounds.max_x - bounds.min_x + 1));
    const y =
      bounds.min_y + Math.floor(Math.random() * (bounds.max_y - bounds.min_y + 1));
    claimTile(name, x, y);
    return;
  }
  const pick = pool[Math.floor(Math.random() * pool.length)]!;
  claimTile(name, pick.x, pick.y);
}

/** Prefer flags closer to matthieu's SW foothold, then by pot. */
function matthieuFlagPriority(f: Flag): number {
  const dist = Math.abs(f.x + 28) + Math.abs(f.y + 28);
  return f.pot * 10 - dist;
}

/** matthieu: grow toward nearby valuable flags, defensive nuke. */
function matthieuTick(nowMs: number): void {
  const owned = ownedList("matthieu");
  const activeFlags = flags
    .filter((f) => !f.nuked)
    .sort((a, b) => matthieuFlagPriority(b) - matthieuFlagPriority(a));

  for (const f of activeFlags) {
    const owner = ownerOf(f.x, f.y);
    if (owner === "matthieu") {
      let threatened = false;
      for (const { dx, dy } of CARDINALS) {
        const o = ownerOf(f.x + dx, f.y + dy);
        if (o && o !== "matthieu" && o !== "nuked") {
          threatened = true;
          break;
        }
      }
      if (threatened && canNuke("matthieu", nowMs)) {
        nukeCell(f.x, f.y);
        lastNukeAt.set("matthieu", nowMs);
        return;
      }
      continue;
    }
    if (owned.length === 0) {
      continue;
    }
    // Only dive for flags reasonably near matthieu territory.
    const near = owned.some(
      (p) => Math.abs(p.x - f.x) + Math.abs(p.y - f.y) <= 20,
    );
    if (!near) {
      continue;
    }
    if (owner !== "nuked") {
      claimTile("matthieu", f.x, f.y);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          claimTile("matthieu", f.x + dx, f.y + dy);
        }
      }
      return;
    }
  }
  botGrow("matthieu");
}

/** Spammer: blast claims aggressively from NE foothold. */
function spammerTick(): void {
  for (let i = 0; i < 2; i++) {
    botGrow("Spammer");
  }
}

function growPots(): void {
  for (const f of flags) {
    if (!f.nuked) {
      f.pot += 0.05;
    }
  }
}

seedStarts();

const botsStartedAt = Date.now();
const BOT_DELAY_MS = Number(process.env.MOCK_BOT_DELAY_MS ?? 5_000);

setInterval(() => {
  if (Date.now() - botsStartedAt < BOT_DELAY_MS) {
    return;
  }
  const now = Date.now();
  matthieuTick(now);
  spammerTick();
  growPots();
}, BOT_CLAIM_MS);

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const path = url.pathname;

  if (path === "/openapi.json" && req.method === "GET") {
    json(res, 200, { openapi: "3.0.0", paths: {} });
    return;
  }

  if (path === "/api/v1/method-limits" && req.method === "GET") {
    json(res, 200, {
      limits: {
        place_tile: { max_per_sec: 20 },
        get_flags: { max_per_sec: 5 },
        get_map: { max_per_sec: 30 },
        get_leaderboard: { max_per_sec: 20 },
        launch_nuke: { max_per_sec: 1 },
      },
    });
    return;
  }

  if (path === "/api/v1/map" && req.method === "GET") {
    json(res, 200, {
      bounds,
      tiles: [...tiles.values()],
      fog_padding_tiles: 0,
    });
    return;
  }

  if (path === "/api/v1/flags" && req.method === "GET") {
    json(res, 200, {
      flags: flags.map((f) => ({
        ...f,
        pot: Math.round(f.pot * 10) / 10,
      })),
    });
    return;
  }

  if (path === "/api/v1/leaderboard" && req.method === "GET") {
    const entries = [
      {
        display_name: SELF_NAME,
        is_self: true,
        tile_count: countTiles(SELF_NAME),
        score_streams: { nuke_cost: 5 },
      },
      {
        display_name: "matthieu",
        is_self: false,
        tile_count: countTiles("matthieu"),
      },
      {
        display_name: "Spammer",
        is_self: false,
        tile_count: countTiles("Spammer"),
      },
    ].sort((a, b) => b.tile_count - a.tile_count);
    json(res, 200, { entries });
    return;
  }

  if (path === "/api/v1/place-tile" && req.method === "POST") {
    const raw = await readBody(req);
    const body = JSON.parse(raw) as { x?: number; y?: number; game_id?: string };
    const x = body.x ?? 0;
    const y = body.y ?? 0;
    const name = resolvePlayerName(req);
    if (!inBounds(x, y)) {
      json(res, 200, {
        rejected: { reason: "REJECTION_REASON_OUT_OF_BOUNDS" },
      });
      return;
    }
    if (ownerOf(x, y) === "nuked") {
      json(res, 200, {
        rejected: { reason: "REJECTION_REASON_INVALID_TARGET" },
      });
      return;
    }
    claimTile(name, x, y);
    json(res, 200, { accepted: true, x, y, game_id: body.game_id ?? GAME_ID });
    return;
  }

  if (path === "/api/v1/launch-nuke" && req.method === "POST") {
    const raw = await readBody(req);
    const body = JSON.parse(raw) as { x?: number; y?: number };
    const name = resolvePlayerName(req);
    const now = Date.now();
    if (!canNuke(name, now)) {
      json(res, 200, {
        rejected: { reason: "REJECTION_REASON_COOLDOWN", retry_after: 30 },
      });
      return;
    }
    const x = body.x ?? 0;
    const y = body.y ?? 0;
    // Nuke radius 1
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (inBounds(x + dx, y + dy)) {
          nukeCell(x + dx, y + dy);
        }
      }
    }
    lastNukeAt.set(name, now);
    json(res, 200, {
      accepted: { effect: { cost_charged: 5, effective_radius_tiles: 1 } },
    });
    return;
  }

  // Map stream not implemented — pollers fall back to snapshot reconcile.
  if (path.includes("/map/stream")) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "no stream in mock" }));
    return;
  }

  json(res, 404, { error: "not found", path });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(
    `mock multiplayer API on http://127.0.0.1:${PORT} game=${GAME_ID} self=${SELF_NAME} vs matthieu + Spammer`,
  );
});
