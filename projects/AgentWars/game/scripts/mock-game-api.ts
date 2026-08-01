#!/usr/bin/env tsx
/**
 * Minimal mock game API for local gateway + cartographer testing when the
 * real upstream is unreachable. Listens on :8000 by default.
 *
 * Usage:
 *   tsx scripts/mock-game-api.ts
 *   GAME_API_URL=http://127.0.0.1:8000 npm run gateway
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const PORT = Number(process.env.MOCK_GAME_PORT ?? 8000);
const GAME_ID = process.env.GAME_ID ?? "mock";

interface Tile {
  x: number;
  y: number;
  ownership: string | { owned: string };
}

const bounds = { min_x: -10, min_y: -10, max_x: 10, max_y: 10 };
const tiles: Tile[] = [];
const flags = [
  { flag_id: "f1", x: 5, y: 5, pot: 50, nuked: false },
  { flag_id: "f2", x: -5, y: -5, pot: 20, nuked: false },
];

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

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const path = url.pathname;

  if (path === "/openapi.json" && req.method === "GET") {
    json(res, 200, { openapi: "3.0.0", paths: {} });
    return;
  }

  if (path === "/api/v1/method-limits" && req.method === "GET") {
    json(res, 200, {
      limits: { place_tile: { max_per_sec: 20 }, get_flags: { max_per_sec: 5 } },
    });
    return;
  }

  if (path === "/api/v1/map" && req.method === "GET") {
    json(res, 200, { bounds, tiles });
    return;
  }

  if (path === "/api/v1/flags" && req.method === "GET") {
    json(res, 200, { flags });
    return;
  }

  if (path === "/api/v1/leaderboard" && req.method === "GET") {
    json(res, 200, {
      entries: [
        { display_name: "MockPlayer", is_self: true, tile_count: tiles.length },
      ],
    });
    return;
  }

  if (path === "/api/v1/place-tile" && req.method === "POST") {
    const raw = await readBody(req);
    const body = JSON.parse(raw) as { x?: number; y?: number; game_id?: string };
    const x = body.x ?? 0;
    const y = body.y ?? 0;
    if (
      x < bounds.min_x ||
      x > bounds.max_x ||
      y < bounds.min_y ||
      y > bounds.max_y
    ) {
      json(res, 200, {
        rejected: { reason: "REJECTION_REASON_OUT_OF_BOUNDS" },
      });
      return;
    }
    const existing = tiles.find((t) => t.x === x && t.y === y);
    if (existing) {
      existing.ownership = { owned: "MockPlayer" };
    } else {
      tiles.push({ x, y, ownership: { owned: "MockPlayer" } });
    }
    json(res, 200, { accepted: true, x, y, game_id: body.game_id ?? GAME_ID });
    return;
  }

  if (path === "/api/v1/launch-nuke" && req.method === "POST") {
    const raw = await readBody(req);
    const body = JSON.parse(raw) as { x?: number; y?: number };
    const f = flags.find((fl) => fl.x === body.x && fl.y === body.y);
    if (f) {
      f.nuked = true;
    }
    json(res, 200, { accepted: true });
    return;
  }

  json(res, 404, { error: "not found", path });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock game API listening on http://127.0.0.1:${PORT}`);
});
