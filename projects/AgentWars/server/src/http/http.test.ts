import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "./app.js";
import { clearRateLimitsForTests } from "./rateLimit.js";
import { clearRegistryForTests } from "../store.js";

describe("HTTP API", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    clearRegistryForTests();
    clearRateLimitsForTests();
    process.env.RATE_LIMIT_DISABLED = "1";
    process.env.GAME_ID = "default";
    app = await createApp();
  });

  afterEach(async () => {
    await app.close();
    delete process.env.RATE_LIMIT_DISABLED;
  });

  it("GET /health returns ok", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("POST /api/v1/place-tile accepts a valid claim", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/place-tile",
      headers: { "x-player-id": "alice" },
      payload: { game_id: "default", x: 0, y: 0 },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { accepted?: { action_id: string } };
    expect(body.accepted?.action_id).toBeTruthy();
  });

  it("POST /api/v1/place-tile rejects invalid target with 409", async () => {
    await app.inject({
      method: "POST",
      url: "/api/v1/place-tile",
      headers: { "x-player-id": "alice" },
      payload: { game_id: "default", x: 0, y: 0 },
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/place-tile",
      headers: { "x-player-id": "alice" },
      payload: { game_id: "default", x: 0, y: 0 },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      rejected: { reason: "REJECTION_REASON_INVALID_TARGET", retry_after: 0 },
    });
  });

  it("returns 501 for stub endpoints", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/request-scan",
      payload: {},
    });
    expect(response.statusCode).toBe(501);
    expect(response.json()).toMatchObject({ error: "not_implemented" });
  });

  it("GET /spectator serves the spectator page", async () => {
    const response = await app.inject({ method: "GET", url: "/spectator" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toMatch(/text\/html/);
    expect(response.body).toContain("AgentWars");
  });

  it("GET /api/v1/spectator/map returns full map without auth", async () => {
    await app.inject({
      method: "POST",
      url: "/api/v1/place-tile",
      headers: { "x-player-id": "alice" },
      payload: { game_id: "spec", x: 0, y: 0 },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/spectator/map?game_id=spec",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { tiles: Array<{ x: number; ownership: unknown }> };
    expect(body.tiles.some((t) => t.x === 0)).toBe(true);
  });

  it("GET /api/v1/spectator/leaderboard returns entries without is_self", async () => {
    await app.inject({
      method: "POST",
      url: "/api/v1/place-tile",
      headers: { "x-player-id": "bob" },
      payload: { game_id: "spec-lb", x: 1, y: 1 },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/spectator/leaderboard?game_id=spec-lb",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      entries: Array<{ display_name: string; is_self: boolean }>;
    };
    expect(body.entries.length).toBeGreaterThan(0);
    expect(body.entries.every((e) => e.is_self === false)).toBe(true);
  });

  it("GET /api/v1/spectator/map returns 404 for unknown game", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/spectator/map?game_id=missing-game",
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "game_not_found" });
  });

  it("POST /api/v1/spectator/map is not allowed", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/spectator/map?game_id=default",
      payload: { game_id: "default", x: 0, y: 0 },
    });
    expect(response.statusCode).toBe(404);
  });

  it("GET /api/v1/method-limits advertises competition limits", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/method-limits?game_id=default",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      place_tile: { max_per_sec: 20 },
      get_map: { max_per_sec: 30 },
      get_flags: { max_per_sec: 20 },
      get_leaderboard: { max_per_sec: 20 },
      get_stats: { max_per_sec: 20 },
      fog_of_war_padding_tiles: 3,
    });
  });
});

describe("rate limiting", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    clearRegistryForTests();
    clearRateLimitsForTests();
    delete process.env.RATE_LIMIT_DISABLED;
    app = await createApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns 429 when place-tile exceeds limit", async () => {
    const path = [
      [0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0],
      [5, 1], [5, 2], [5, 3], [5, 4], [5, 5],
      [4, 5], [3, 5], [2, 5], [1, 5], [0, 5],
      [-1, 5], [-2, 5], [-3, 5], [-4, 5],
    ];
    for (const [x, y] of path) {
      const ok = await app.inject({
        method: "POST",
        url: "/api/v1/place-tile",
        headers: { "x-player-id": "bob" },
        payload: { game_id: "rl", x, y },
      });
      expect(ok.statusCode).toBe(200);
    }

    const limited = await app.inject({
      method: "POST",
      url: "/api/v1/place-tile",
      headers: { "x-player-id": "bob" },
      payload: { game_id: "rl", x: -5, y: 4 },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({
      rejected: { reason: "REJECTION_REASON_RATE_LIMITED", retry_after: 1 },
    });
    expect(limited.headers["x-ratelimit-limit"]).toBe("20");
  });

  it("returns 429 when launch-nuke exceeds limit", async () => {
    for (let i = 0; i < 20; i += 1) {
      const x = i % 5;
      const y = Math.floor(i / 5);
      await app.inject({
        method: "POST",
        url: "/api/v1/place-tile",
        headers: { "x-player-id": "nuke-bot" },
        payload: { game_id: "nuke-rl", x, y },
      });
    }

    for (let i = 0; i < 20; i += 1) {
      const ok = await app.inject({
        method: "POST",
        url: "/api/v1/launch-nuke",
        headers: { "x-player-id": "nuke-bot" },
        payload: { game_id: "nuke-rl", target_x: 0, target_y: 0 },
      });
      expect(ok.statusCode).toBe(200);
    }

    const limited = await app.inject({
      method: "POST",
      url: "/api/v1/launch-nuke",
      headers: { "x-player-id": "nuke-bot" },
      payload: { game_id: "nuke-rl", target_x: 1, target_y: 0 },
    });
    expect(limited.statusCode).toBe(429);
  });
});

describe("harness", () => {
  let app: FastifyInstance;
  const fixturePath = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../fixtures/enclosure-mono-q.json",
  );

  beforeEach(async () => {
    clearRegistryForTests();
    clearRateLimitsForTests();
    process.env.RATE_LIMIT_DISABLED = "1";
    process.env.NODE_ENV = "test";
    app = await createApp();
  });

  afterEach(async () => {
    await app.close();
    delete process.env.RATE_LIMIT_DISABLED;
  });

  it("seeds fixture and steps place-tile", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/_harness/games",
      payload: { id: "mono-q" },
    });
    expect(created.statusCode).toBe(201);

    const snapshot = JSON.parse(readFileSync(fixturePath, "utf8")) as unknown;
    const seeded = await app.inject({
      method: "POST",
      url: "/_harness/games/mono-q/seed",
      payload: snapshot,
    });
    expect(seeded.statusCode).toBe(200);

    const stepped = await app.inject({
      method: "POST",
      url: "/_harness/games/mono-q/step",
      payload: {
        playerExternalId: "p1",
        action: "place_tile",
        x: -1,
        y: -1,
      },
    });
    expect(stepped.statusCode).toBe(200);
    const body = stepped.json() as {
      events: Array<{ event_type: string }>;
      state: { leaderboard: { entries: unknown[] } };
    };
    expect(body.events.some((e) => e.event_type === "tile_captured")).toBe(true);
    expect(body.state.leaderboard.entries.length).toBeGreaterThan(0);
  });
});

describe("harness security", () => {
  let app: FastifyInstance;
  const savedNodeEnv = process.env.NODE_ENV;
  const savedHarnessToken = process.env.HARNESS_TOKEN;

  afterEach(async () => {
    await app.close();
    if (savedNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = savedNodeEnv;
    }
    if (savedHarnessToken === undefined) {
      delete process.env.HARNESS_TOKEN;
    } else {
      process.env.HARNESS_TOKEN = savedHarnessToken;
    }
  });

  it("does not register harness routes without HARNESS_TOKEN outside test", async () => {
    clearRegistryForTests();
    process.env.NODE_ENV = "production";
    delete process.env.HARNESS_TOKEN;
    app = await createApp();

    const response = await app.inject({
      method: "POST",
      url: "/_harness/games",
      payload: { id: "blocked" },
    });
    expect(response.statusCode).toBe(404);
  });

  it("rejects harness requests with invalid token when HARNESS_TOKEN is set", async () => {
    clearRegistryForTests();
    process.env.NODE_ENV = "production";
    process.env.HARNESS_TOKEN = "secret-harness-token";
    app = await createApp();

    const forbidden = await app.inject({
      method: "POST",
      url: "/_harness/games",
      headers: { "x-harness-token": "wrong-token" },
      payload: { id: "blocked" },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toEqual({ error: "harness_forbidden" });

    const allowed = await app.inject({
      method: "POST",
      url: "/_harness/games",
      headers: { "x-harness-token": "secret-harness-token" },
      payload: { id: "allowed" },
    });
    expect(allowed.statusCode).toBe(201);
  });
});
