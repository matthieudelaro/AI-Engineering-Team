import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { GameSnapshot } from "../engine/game.js";
import {
  createGame,
  getGame,
  resetGame,
} from "../store.js";

const registerPlayerBody = z.object({
  externalId: z.string().min(1),
  displayName: z.string().min(1),
  color: z.string().min(1),
});

const stepBody = z.object({
  playerExternalId: z.string().min(1),
  action: z.enum(["place_tile", "launch_nuke"]),
  x: z.number().int(),
  y: z.number().int(),
});

function harnessEnabled(): boolean {
  if (process.env.NODE_ENV === "test") {
    return true;
  }
  return Boolean(process.env.HARNESS_TOKEN);
}

function harnessAuthorized(token: string | undefined): boolean {
  const expected = process.env.HARNESS_TOKEN;
  if (process.env.NODE_ENV === "test" && !expected) {
    return true;
  }
  if (!expected || !token) {
    return false;
  }
  const provided = Buffer.from(token);
  const required = Buffer.from(expected);
  if (provided.length !== required.length) {
    return false;
  }
  return timingSafeEqual(provided, required);
}

export async function registerHarnessRoutes(app: FastifyInstance): Promise<void> {
  if (!harnessEnabled()) {
    return;
  }

  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/_harness")) {
      return;
    }
    const tokenHeader = request.headers["x-harness-token"];
    const token = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
    if (!harnessAuthorized(token)) {
      return reply.status(403).send({ error: "harness_forbidden" });
    }
  });

  app.post("/_harness/games", async (request, reply) => {
    const body = (request.body ?? {}) as { id?: string; reset?: boolean };
    const id = body.id ?? `harness-${Date.now()}`;
    const game = body.reset ? resetGame(id) : createGame(id);
    reply.status(201).send({ game_id: game.id });
  });

  app.post("/_harness/games/:id/players", async (request, reply) => {
    const { id } = request.params as { id: string };
    const game = getGame(id);
    if (!game) {
      reply.status(404).send({ error: "game_not_found" });
      return;
    }
    const parsed = registerPlayerBody.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400).send({ error: "invalid_request", details: parsed.error.message });
      return;
    }
    const playerId = game.registerPlayer(
      parsed.data.externalId,
      parsed.data.displayName,
      parsed.data.color,
    );
    if (playerId === null) {
      reply.status(409).send({ error: "game_full" });
      return;
    }
    reply.status(201).send({ player_id: playerId });
  });

  app.post("/_harness/games/:id/seed", async (request, reply) => {
    const { id } = request.params as { id: string };
    const game = getGame(id) ?? createGame(id);
    game.seedFromSnapshot(request.body as GameSnapshot);
    reply.send({ ok: true, tick: game.tick });
  });

  app.get("/_harness/games/:id/state", async (request, reply) => {
    const { id } = request.params as { id: string };
    const game = getGame(id);
    if (!game) {
      reply.status(404).send({ error: "game_not_found" });
      return;
    }
    reply.send({
      snapshot: game.toSnapshot(),
      map: game.getMapSpectator(),
      events: game.events,
      leaderboard: game.getLeaderboard(),
      flags: game.getFlags(),
    });
  });

  app.post("/_harness/games/:id/step", async (request, reply) => {
    const { id } = request.params as { id: string };
    const game = getGame(id);
    if (!game) {
      reply.status(404).send({ error: "game_not_found" });
      return;
    }
    const parsed = stepBody.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400).send({ error: "invalid_request", details: parsed.error.message });
      return;
    }
    const player = game.findPlayerByExternalId(parsed.data.playerExternalId);
    if (!player) {
      reply.status(404).send({ error: "player_not_found" });
      return;
    }

    const events =
      parsed.data.action === "place_tile"
        ? game.placeTile(player.id, parsed.data.x, parsed.data.y).events
        : game.launchNuke(player.id, parsed.data.x, parsed.data.y).events;

    reply.send({
      events,
      state: {
        snapshot: game.toSnapshot(),
        map: game.getMapSpectator(),
        leaderboard: game.getLeaderboard(),
        flags: game.getFlags(),
      },
    });
  });
}
