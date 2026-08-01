import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  NUKE_COST_MODEL,
  NUKE_EXPLOSION_MODEL,
  NUKE_COOLDOWN_MS,
} from "../engine/constants.js";
import { buildAcceptedResponse } from "../engine/game.js";
import { getGame, getOrCreateGame, resolvePlayer } from "../store.js";
import {
  enforceRateLimit,
  notImplemented,
  requirePlayerId,
  sendRejection,
} from "./errors.js";
import { RATE_LIMITS } from "./rateLimit.js";

const placeTileBody = z.object({
  game_id: z.string().min(1),
  x: z.number().int(),
  y: z.number().int(),
});

const launchNukeBody = z.object({
  game_id: z.string().min(1),
  target_x: z.number().int(),
  target_y: z.number().int(),
});

const gameIdQuery = z.object({
  game_id: z.string().min(1),
});

const STUB_ROUTES: Array<{ method: "GET" | "POST"; path: string; details: string }> = [
  { method: "POST", path: "/api/v1/request-scan", details: "POST /api/v1/request-scan not available in v1" },
  { method: "POST", path: "/api/v1/emotion", details: "POST /api/v1/emotion not available in v1" },
  { method: "GET", path: "/api/v1/games/:gameId/channels", details: "GET /api/v1/games/{game_id}/channels not available in v1" },
  {
    method: "GET",
    path: "/api/v1/games/:gameId/channels/:channelId/messages",
    details: "channel messages not available in v1",
  },
  {
    method: "POST",
    path: "/api/v1/games/:gameId/channels/:channelId/messages",
    details: "channel messages not available in v1",
  },
  { method: "GET", path: "/api/v1/games/:gameId/events", details: "GET /api/v1/games/{game_id}/events not available in v1" },
  { method: "POST", path: "/api/v1/auth/token", details: "POST /api/v1/auth/token not available in v1" },
];

function loadOpenApiSpec(): unknown {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "../openapi/openapi.json"),
    join(here, "../../../tmp/AgentWars-openapi.json"),
  ];
  for (const path of candidates) {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as unknown;
    } catch {
      // try next candidate
    }
  }
  return {
    openapi: "3.0.0",
    info: { title: "AgentWars API", version: "1.0.0" },
    paths: {},
  };
}


export async function registerRoutes(app: FastifyInstance): Promise<void> {
  const openApi = loadOpenApiSpec();

  app.get("/health", async () => ({ status: "ok" }));
  app.get("/openapi.json", async () => openApi);

  for (const route of STUB_ROUTES) {
    app.route({
      method: route.method,
      url: route.path,
      handler: async (_request, reply) => {
        notImplemented(reply, route.details);
      },
    });
  }

  app.post("/api/v1/place-tile", async (request, reply) => {
    const playerIdHeader = request.headers["x-player-id"];
    const externalId = Array.isArray(playerIdHeader)
      ? playerIdHeader[0]
      : playerIdHeader;
    if (!requirePlayerId(reply, externalId)) {
      return;
    }
    if (!enforceRateLimit(reply, externalId, "place_tile")) {
      return;
    }

    const parsed = placeTileBody.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400).send({ error: "invalid_request", details: parsed.error.message });
      return;
    }

    const game = getOrCreateGame(parsed.data.game_id);
    const resolved = resolvePlayer(game, externalId);
    if ("error" in resolved) {
      reply.status(403).send({ error: resolved.error });
      return;
    }

    const result = game.placeTile(resolved.playerId, parsed.data.x, parsed.data.y);
    if (!result.accepted) {
      sendRejection(reply, result.rejection_reason ?? "INVALID_TARGET");
      return;
    }
    reply.send(buildAcceptedResponse());
  });

  app.get("/api/v1/map", async (request, reply) => {
    const playerIdHeader = request.headers["x-player-id"];
    const externalId = Array.isArray(playerIdHeader)
      ? playerIdHeader[0]
      : playerIdHeader;
    if (!requirePlayerId(reply, externalId)) {
      return;
    }
    if (!enforceRateLimit(reply, externalId, "get_map")) {
      return;
    }

    const parsed = gameIdQuery.safeParse(request.query);
    if (!parsed.success) {
      reply.status(400).send({ error: "invalid_request", details: parsed.error.message });
      return;
    }

    const game = getOrCreateGame(parsed.data.game_id);
    const resolved = resolvePlayer(game, externalId);
    if ("error" in resolved) {
      reply.status(403).send({ error: resolved.error });
      return;
    }

    reply.send(game.getMapForPlayer(resolved.playerId));
  });

  app.get("/api/v1/games/:gameId/map/stream", async (request, reply) => {
    const { gameId } = request.params as { gameId: string };
    const query = request.query as { after_event_id?: string };
    const game = getGame(gameId) ?? getOrCreateGame(gameId);

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const writeEvent = (event: {
      event_id: string;
      event_type: string;
      detail: Record<string, unknown>;
      at?: string;
    }): void => {
      if (event.event_type !== "tile_captured") {
        return;
      }
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    for (const event of game.getEventsAfter(query.after_event_id)) {
      writeEvent(event);
    }

    const unsubscribe = game.subscribe(writeEvent);
    const heartbeat = setInterval(() => {
      reply.raw.write(": ping\n\n");
    }, 15_000);

    const cleanup = (): void => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    request.raw.on("close", cleanup);
    request.raw.on("error", cleanup);
  });

  app.get("/api/v1/leaderboard", async (request, reply) => {
    const playerIdHeader = request.headers["x-player-id"];
    const externalId = Array.isArray(playerIdHeader)
      ? playerIdHeader[0]
      : playerIdHeader;
    if (!requirePlayerId(reply, externalId)) {
      return;
    }
    if (!enforceRateLimit(reply, externalId, "get_leaderboard")) {
      return;
    }

    const parsed = gameIdQuery.safeParse(request.query);
    if (!parsed.success) {
      reply.status(400).send({ error: "invalid_request", details: parsed.error.message });
      return;
    }

    const game = getOrCreateGame(parsed.data.game_id);
    resolvePlayer(game, externalId);
    reply.send(game.getLeaderboard(externalId));
  });

  app.get("/api/v1/method-limits", async (request, reply) => {
    const parsed = gameIdQuery.safeParse(request.query);
    if (!parsed.success) {
      reply.status(400).send({ error: "invalid_request", details: parsed.error.message });
      return;
    }
    if (!getOrCreateGame(parsed.data.game_id)) {
      reply.status(404).send({ error: "game_not_found" });
      return;
    }
    reply.send({
      place_tile: { max_per_sec: RATE_LIMITS.place_tile },
      get_map: { max_per_sec: RATE_LIMITS.get_map },
      get_flags: { max_per_sec: RATE_LIMITS.get_flags },
      get_leaderboard: { max_per_sec: RATE_LIMITS.get_leaderboard },
      get_stats: { max_per_sec: RATE_LIMITS.get_stats },
      launch_nuke: {
        cooldown: NUKE_COOLDOWN_MS / 1000,
        max_active_per_player: 1,
        max_per_sec: RATE_LIMITS.launch_nuke,
        explosion_model: { ...NUKE_EXPLOSION_MODEL },
        cost_model: { ...NUKE_COST_MODEL },
      },
      fog_of_war_padding_tiles: 3,
    });
  });

  app.get("/api/v1/flags", async (request, reply) => {
    const playerIdHeader = request.headers["x-player-id"];
    const externalId = Array.isArray(playerIdHeader)
      ? playerIdHeader[0]
      : playerIdHeader;
    if (!requirePlayerId(reply, externalId)) {
      return;
    }
    if (!enforceRateLimit(reply, externalId, "get_flags")) {
      return;
    }

    const parsed = gameIdQuery.safeParse(request.query);
    if (!parsed.success) {
      reply.status(400).send({ error: "invalid_request", details: parsed.error.message });
      return;
    }

    const game = getOrCreateGame(parsed.data.game_id);
    resolvePlayer(game, externalId);
    reply.send(game.getFlags());
  });

  app.post("/api/v1/launch-nuke", async (request, reply) => {
    const playerIdHeader = request.headers["x-player-id"];
    const externalId = Array.isArray(playerIdHeader)
      ? playerIdHeader[0]
      : playerIdHeader;
    if (!requirePlayerId(reply, externalId)) {
      return;
    }
    if (!enforceRateLimit(reply, externalId, "launch_nuke")) {
      return;
    }

    const parsed = launchNukeBody.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400).send({ error: "invalid_request", details: parsed.error.message });
      return;
    }

    const game = getOrCreateGame(parsed.data.game_id);
    const resolved = resolvePlayer(game, externalId);
    if ("error" in resolved) {
      reply.status(403).send({ error: resolved.error });
      return;
    }

    const result = game.launchNuke(
      resolved.playerId,
      parsed.data.target_x,
      parsed.data.target_y,
    );
    if (!result.accepted) {
      sendRejection(
        reply,
        result.rejection_reason ?? "INVALID_TARGET",
        result.retry_after ?? 0,
      );
      return;
    }
    reply.send(
      buildAcceptedResponse(undefined, {
        launch_id: result.launchId!,
        effective_radius_tiles: result.radius,
        cost_charged: result.cost,
      }),
    );
  });

  app.get("/api/v1/players/:name/stats", async (request, reply) => {
    const playerIdHeader = request.headers["x-player-id"];
    const externalId = Array.isArray(playerIdHeader)
      ? playerIdHeader[0]
      : playerIdHeader;
    if (!requirePlayerId(reply, externalId)) {
      return;
    }
    if (!enforceRateLimit(reply, externalId, "get_stats")) {
      return;
    }

    const { name } = request.params as { name: string };
    const query = request.query as { game_id?: string };
    const gameId = query.game_id ?? process.env.GAME_ID ?? "default";
    const game = getOrCreateGame(gameId);
    const stats = game.getPlayerStats(decodeURIComponent(name));
    if (!stats) {
      reply.status(404).send({ error: "player_not_found" });
      return;
    }
    reply.send(stats);
  });
}
