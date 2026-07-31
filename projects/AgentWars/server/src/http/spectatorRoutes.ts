import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { getGame } from "../store.js";

const gameIdQuery = z.object({
  game_id: z.string().min(1),
});

const SPECTATOR_DIR = join(dirname(fileURLToPath(import.meta.url)), "../spectator");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
};

function sendStatic(reply: FastifyReply, filename: string): void {
  const path = join(SPECTATOR_DIR, filename);
  const ext = filename.slice(filename.lastIndexOf("."));
  const body = readFileSync(path);
  reply.header("Cache-Control", "public, max-age=60");
  reply.type(MIME[ext] ?? "application/octet-stream").send(body);
}

export async function registerSpectatorRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async (_request, reply) => {
    sendStatic(reply, "index.html");
  });

  app.get("/spectator", async (_request, reply) => {
    sendStatic(reply, "index.html");
  });

  app.get("/spectator/spectator.css", async (_request, reply) => {
    sendStatic(reply, "spectator.css");
  });

  app.get("/spectator/spectator.js", async (_request, reply) => {
    sendStatic(reply, "spectator.js");
  });

  app.get("/api/v1/spectator/map", async (request, reply) => {
    const parsed = gameIdQuery.safeParse(request.query);
    if (!parsed.success) {
      reply.status(400).send({ error: "invalid_request", details: parsed.error.message });
      return;
    }

    const game = getGame(parsed.data.game_id);
    if (!game) {
      reply.status(404).send({ error: "game_not_found" });
      return;
    }
    reply.send(game.getMapSpectator());
  });

  app.get("/api/v1/spectator/leaderboard", async (request, reply) => {
    const parsed = gameIdQuery.safeParse(request.query);
    if (!parsed.success) {
      reply.status(400).send({ error: "invalid_request", details: parsed.error.message });
      return;
    }

    const game = getGame(parsed.data.game_id);
    if (!game) {
      reply.status(404).send({ error: "game_not_found" });
      return;
    }
    reply.send(game.getLeaderboard());
  });
}
