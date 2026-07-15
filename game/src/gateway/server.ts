import Fastify, { type FastifyInstance } from "fastify";
import { Readable } from "node:stream";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Env } from "../config.js";
import type { ApiEndpointsConfig } from "../config.js";
import { createDb, type Database } from "../db/index.js";
import { apiCalls } from "../db/schema.js";
import { buildRateStatsResponse, endpointLabel, formatSourceBreakdown, PINNED_ENDPOINT_DEFAULTS, PINNED_ENDPOINT_KEYS } from "./rateStats.js";
import { listCachedGameStates, readCachedGameState } from "./stateCache.js";
import { redactHeaders, truncateBody } from "./redact.js";
import { getUiClaimActivity, touchUiClaimActivity } from "./uiClaimPriority.js";
import {
  ackUiClaimTiles,
  clearUiClaimQueue,
  enqueueUiClaimTiles,
  getUiClaimQueueStats,
  requeueUiClaimTilesFront,
  scheduleUiClaimRetry,
  takeUiClaimTiles,
  UI_CLAIM_TAKE_DEFAULT_LIMIT,
} from "./uiClaimQueue.js";

const uiClaimTileSchema = z.object({
  x: z.number(),
  y: z.number(),
});

const uiClaimEnqueueSchema = z.object({
  tiles: z.array(uiClaimTileSchema).min(1),
});

const uiClaimTakeSchema = z.object({
  limit: z.number().int().positive().optional(),
});

const uiClaimRetrySchema = uiClaimTileSchema;

export interface GatewayStats {
  totalCalls: number;
  errorCalls: number;
}

export interface GatewayServer {
  app: FastifyInstance;
  pool: ReturnType<typeof createDb>["pool"];
  db: Database;
  stats: GatewayStats;
}

function shouldForwardResponseHeader(headerName: string): boolean {
  const lower = headerName.toLowerCase();
  return (
    lower.startsWith("x-ratelimit-") ||
    lower === "content-type" ||
    lower === "cache-control"
  );
}

function isEventStream(contentType: string | null): boolean {
  return (contentType ?? "").includes("text/event-stream");
}

function buildUpstreamUrl(base: string, path: string, query: string): string {
  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return query ? `${normalizedBase}${normalizedPath}?${query}` : `${normalizedBase}${normalizedPath}`;
}

function useEventMode(env: Env): boolean {
  return env.AUTH_MODE === "event" || env.GAME_API_TOKEN === "your-token-here";
}

function buildUpstreamAuthHeaders(env: Env, authHeader: string): Record<string, string> {
  if (useEventMode(env)) {
    return { "X-Player-Id": env.PLAYER_ID };
  }
  return { [authHeader]: `Bearer ${env.GAME_API_TOKEN}` };
}

export async function createGatewayServer(
  env: Env,
  endpointsConfig: ApiEndpointsConfig,
): Promise<GatewayServer> {
  const { db, pool } = createDb(env);
  const stats: GatewayStats = { totalCalls: 0, errorCalls: 0 };

  const app = Fastify({ logger: true });

  app.addHook("onRequest", async (request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Content-Type, X-Source");
  });

  app.get("/_gateway/health", async () => ({
    ok: true,
    upstream: endpointsConfig.upstreamBaseUrl,
    authMode: useEventMode(env) ? "event" : "token",
    playerId: env.PLAYER_ID,
  }));

  app.get("/_gateway/stats", async () => {
    const rows = await db
      .select({
        total: sql<number>`count(*)::int`,
        errors: sql<number>`count(*) filter (where ${apiCalls.error} is not null or ${apiCalls.responseStatus} >= 500)::int`,
      })
      .from(apiCalls);
    const row = rows[0];
    return {
      inMemory: stats,
      persisted: {
        totalCalls: row?.total ?? 0,
        errorCalls: row?.errors ?? 0,
      },
    };
  });

  app.get("/_gateway/rate-stats", async (request) => {
    const query = request.query as { window_sec?: string };
    const parsed = query.window_sec ? Number.parseInt(query.window_sec, 10) : 10;
    const windowSec = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 120) : 10;
    const data = await buildRateStatsResponse(db, windowSec);
    return {
      ...data,
      history: "postgresql://api_calls",
      endpoints: data.endpoints.map((entry) => ({
        ...entry,
        label: endpointLabel(entry.key),
        maxRps: data.limits[entry.key] ?? PINNED_ENDPOINT_DEFAULTS[entry.key as keyof typeof PINNED_ENDPOINT_DEFAULTS]?.maxRps ?? null,
        sourceBreakdown: formatSourceBreakdown(entry.sources),
        pinned: (PINNED_ENDPOINT_KEYS as readonly string[]).includes(entry.key),
      })),
    };
  });

  app.get("/_gateway/ui-claim-active", async () =>
    getUiClaimActivity(env.UI_CLAIM_PRIORITY_MS),
  );

  app.post("/_gateway/ui-claim-active", async (_request, reply) => {
    touchUiClaimActivity();
    return reply.status(204).send();
  });

  app.get("/_gateway/ui-claim-queue", async () => getUiClaimQueueStats());

  app.delete("/_gateway/ui-claim-queue", async (_request, reply) => {
    clearUiClaimQueue();
    return reply.status(204).send();
  });

  app.post("/_gateway/ui-claim-queue", async (request, reply) => {
    const parsed = uiClaimEnqueueSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_body", issues: parsed.error.issues });
    }
    enqueueUiClaimTiles(parsed.data.tiles);
    touchUiClaimActivity();
    return reply.status(204).send();
  });

  app.post("/_gateway/ui-claim-queue/take", async (request, reply) => {
    const parsed = uiClaimTakeSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_body", issues: parsed.error.issues });
    }
    const limit = parsed.data.limit ?? UI_CLAIM_TAKE_DEFAULT_LIMIT;
    return { tiles: takeUiClaimTiles(limit) };
  });

  app.post("/_gateway/ui-claim-queue/retry", async (request, reply) => {
    const parsed = uiClaimRetrySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_body", issues: parsed.error.issues });
    }
    const { x, y } = parsed.data;
    scheduleUiClaimRetry(x, y);
    return reply.status(204).send();
  });

  app.post("/_gateway/ui-claim-queue/requeue", async (request, reply) => {
    const parsed = uiClaimEnqueueSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_body", issues: parsed.error.issues });
    }
    requeueUiClaimTilesFront(parsed.data.tiles);
    return reply.status(204).send();
  });

  app.post("/_gateway/ui-claim-queue/ack", async (request, reply) => {
    const parsed = uiClaimEnqueueSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_body", issues: parsed.error.issues });
    }
    ackUiClaimTiles(parsed.data.tiles);
    return reply.status(204).send();
  });

  app.get("/_gateway/state", async () => {
    const snapshots = await listCachedGameStates(db);
    return {
      source: "postgresql://game_states",
      snapshots,
    };
  });

  app.get<{ Params: { endpointKey: string } }>(
    "/_gateway/state/:endpointKey",
    async (request, reply) => {
      const { endpointKey } = request.params;
      const cached = await readCachedGameState(db, endpointKey);
      if (!cached) {
        return reply.status(404).send({
          error: "no_snapshot",
          endpointKey,
          message: "pollers have not written this state yet — run npm run pollers",
        });
      }
      reply.header("X-State-Fetched-At", cached.fetchedAt);
      reply.header("X-State-Source", "postgresql://game_states");
      return cached.payload;
    },
  );

  app.all("/*", async (request, reply) => {
    if (request.method === "OPTIONS") {
      return reply.status(204).send();
    }
    if (request.url.startsWith("/_gateway/")) {
      return reply.status(404).send({ error: "not found" });
    }

    const started = Date.now();
    const path = request.url.split("?")[0] ?? "/";
    const query = request.url.includes("?")
      ? (request.url.split("?")[1] ?? "")
      : "";
    const policyId = request.headers["x-policy-id"];
    const runIdHeader = request.headers["x-run-id"];
    const source = request.headers["x-source"];
    const runId =
      typeof runIdHeader === "string" && runIdHeader !== ""
        ? Number.parseInt(runIdHeader, 10)
        : undefined;

    const requestBody =
      request.body === undefined || request.body === null
        ? undefined
        : typeof request.body === "string"
          ? request.body
          : JSON.stringify(request.body);

    const upstreamHeaders: Record<string, string> = {
      ...buildUpstreamAuthHeaders(env, endpointsConfig.authHeader),
    };

    const contentType = request.headers["content-type"];
    if (typeof contentType === "string") {
      upstreamHeaders["content-type"] = contentType;
    }

    const acceptHeader = request.headers.accept;
    if (typeof acceptHeader === "string") {
      upstreamHeaders.accept = acceptHeader;
    }

    const upstreamUrl = buildUpstreamUrl(
      endpointsConfig.upstreamBaseUrl,
      path,
      query,
    );

    if (
      request.method === "POST" &&
      path === "/api/v1/place-tile" &&
      typeof source === "string" &&
      source.toLowerCase() === "ui"
    ) {
      touchUiClaimActivity();
    }

    let responseStatus: number | undefined;
    let responseBody: string | undefined;
    let error: string | undefined;

    try {
      const upstreamResponse = await fetch(upstreamUrl, {
        method: request.method,
        headers: upstreamHeaders,
        body:
          request.method === "GET" || request.method === "HEAD"
            ? undefined
            : requestBody,
      });

      responseStatus = upstreamResponse.status;

      const upstreamContentType = upstreamResponse.headers.get("content-type");
      if (
        isEventStream(upstreamContentType) &&
        upstreamResponse.ok &&
        upstreamResponse.body
      ) {
        stats.totalCalls += 1;
        await db.insert(apiCalls).values({
          method: request.method,
          path,
          query: query || null,
          requestHeadersRedacted: redactHeaders(
            request.headers as Record<string, string | string[] | undefined>,
          ),
          requestBody: truncateBody(requestBody, env.GATEWAY_MAX_BODY_BYTES),
          responseStatus,
          responseBody: truncateBody("[sse stream]", env.GATEWAY_MAX_BODY_BYTES),
          latencyMs: Date.now() - started,
          policyId: typeof policyId === "string" ? policyId : null,
          runId: Number.isFinite(runId) ? runId : null,
          source: typeof source === "string" ? source : "gateway",
        });

        reply.status(responseStatus);
        for (const [headerName, headerValue] of upstreamResponse.headers.entries()) {
          if (shouldForwardResponseHeader(headerName)) {
            reply.header(headerName, headerValue);
          }
        }
        return reply.send(Readable.fromWeb(upstreamResponse.body));
      }

      responseBody = await upstreamResponse.text();
      stats.totalCalls += 1;
      if (responseStatus >= 500) {
        stats.errorCalls += 1;
      }

      await db.insert(apiCalls).values({
        method: request.method,
        path,
        query: query || null,
        requestHeadersRedacted: redactHeaders(
          request.headers as Record<string, string | string[] | undefined>,
        ),
        requestBody: truncateBody(requestBody, env.GATEWAY_MAX_BODY_BYTES),
        responseStatus,
        responseBody: truncateBody(responseBody, env.GATEWAY_MAX_BODY_BYTES),
        latencyMs: Date.now() - started,
        policyId: typeof policyId === "string" ? policyId : null,
        runId: Number.isFinite(runId) ? runId : null,
        source: typeof source === "string" ? source : "gateway",
      });

      reply.status(responseStatus);
      for (const [headerName, headerValue] of upstreamResponse.headers.entries()) {
        if (shouldForwardResponseHeader(headerName)) {
          reply.header(headerName, headerValue);
        }
      }
      return reply.send(responseBody);
    } catch (err) {
      error = err instanceof Error ? err.message : "unknown error";
      stats.totalCalls += 1;
      stats.errorCalls += 1;

      await db.insert(apiCalls).values({
        method: request.method,
        path,
        query: query || null,
        requestHeadersRedacted: redactHeaders(
          request.headers as Record<string, string | string[] | undefined>,
        ),
        requestBody: truncateBody(requestBody, env.GATEWAY_MAX_BODY_BYTES),
        responseStatus: responseStatus ?? null,
        responseBody: truncateBody(responseBody, env.GATEWAY_MAX_BODY_BYTES),
        latencyMs: Date.now() - started,
        policyId: typeof policyId === "string" ? policyId : null,
        runId: Number.isFinite(runId) ? runId : null,
        error,
        source: typeof source === "string" ? source : "gateway",
      });

      return reply.status(502).send({ error: "upstream request failed", detail: error });
    }
  });

  return { app, pool, db, stats };
}

export async function startGateway(
  env: Env,
  endpointsConfig: ApiEndpointsConfig,
): Promise<GatewayServer> {
  const server = await createGatewayServer(env, endpointsConfig);
  await server.app.listen({ port: env.GATEWAY_PORT, host: env.GATEWAY_HOST });
  return server;
}

export async function stopGateway(server: GatewayServer): Promise<void> {
  await server.app.close();
  await server.pool.end();
}
