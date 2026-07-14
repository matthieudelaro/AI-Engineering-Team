import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { Env, ApiEndpointsConfig } from "../config.js";
import { GameClient } from "../client/gameClient.js";
import type { Database } from "../db/index.js";
import { gameStates, policyEvents } from "../db/schema.js";
import {
  fetchMethodLimits,
  maxPerSecForEndpoint,
  pollIntervalMsForRps,
  type MethodLimitsResponse,
} from "./methodLimits.js";
import { TokenBucketRateLimiter } from "./rateLimiter.js";
import { startMapStream } from "./mapStream.js";

export interface PollerHandle {
  stop: () => void;
}

interface EndpointWorkerState {
  stopped: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

function hashPayload(payload: unknown): string {
  const serialized = JSON.stringify(payload);
  return createHash("sha256").update(serialized).digest("hex");
}

async function logPollerEvent(
  db: Database,
  level: "info" | "warn" | "error",
  eventType: string,
  message: string,
  data?: Record<string, unknown>,
): Promise<void> {
  await db.insert(policyEvents).values({
    runId: null,
    level,
    eventType,
    message,
    dataJson: data ?? null,
    source: "poller",
  });
}

async function pollEndpoint(
  env: Env,
  db: Database,
  endpointKey: string,
  method: string,
  path: string,
  pollIntervalMs: number,
  state: EndpointWorkerState,
  limiter: TokenBucketRateLimiter,
): Promise<void> {
  if (state.stopped) {
    return;
  }

  const client = new GameClient(env, { source: "poller" });

  try {
    await limiter.acquire();
    const response =
      method === "GET" ? await client.get(path) : await client.post(path);

    if (response.status === 429 || response.status >= 500) {
      await logPollerEvent(db, "warn", "poll_backoff", `backoff for ${endpointKey}`, {
        status: response.status,
      });
      const backoffMs =
        response.status === 429 ? pollIntervalMs * 3 : pollIntervalMs * 2;
      state.timer = setTimeout(() => {
        void pollEndpoint(
          env,
          db,
          endpointKey,
          method,
          path,
          pollIntervalMs,
          state,
          limiter,
        );
      }, backoffMs);
      return;
    }

    let payload: unknown = null;
    try {
      payload = response.json();
    } catch {
      payload = { raw: response.body };
    }

    const payloadHash = hashPayload(payload);
    const latest = await db
      .select()
      .from(gameStates)
      .where(eq(gameStates.endpointKey, endpointKey))
      .orderBy(desc(gameStates.fetchedAt))
      .limit(1);

    const previous = latest[0];
    if (!previous || previous.etagOrHash !== payloadHash) {
      await db.insert(gameStates).values({
        endpointKey,
        payloadJson: payload,
        etagOrHash: payloadHash,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown poll error";
    await logPollerEvent(db, "error", "poll_error", message, { endpointKey });
  }

  if (!state.stopped) {
    state.timer = setTimeout(() => {
      void pollEndpoint(
        env,
        db,
        endpointKey,
        method,
        path,
        pollIntervalMs,
        state,
        limiter,
      );
    }, pollIntervalMs);
  }
}

export async function startPollers(
  env: Env,
  db: Database,
  endpointsConfig: ApiEndpointsConfig,
): Promise<PollerHandle[]> {
  const bootstrapClient = new GameClient(env, { source: "poller" });
  const methodLimits: MethodLimitsResponse | null = await fetchMethodLimits(
    bootstrapClient,
    env.GAME_ID,
  );

  if (methodLimits) {
    await logPollerEvent(db, "info", "limits_loaded", "method limits loaded", {
      get_flags: methodLimits.get_flags?.max_per_sec,
      get_map: methodLimits.get_map?.max_per_sec,
      get_leaderboard: methodLimits.get_leaderboard?.max_per_sec,
    });
  }

  const handles: PollerHandle[] = [];

  for (const endpoint of endpointsConfig.stateEndpoints) {
    if (endpoint.streamPath) {
      const streamHandle = await startMapStream(
        env,
        db,
        endpoint.path,
        endpoint.streamPath,
      );
      handles.push(streamHandle);
      continue;
    }

    const maxPerSec = maxPerSecForEndpoint(
      methodLimits,
      endpoint.key,
      endpoint.limitKey,
      endpoint.maxPerSec,
      env.POLL_MAX_RPS,
    );
    const pollIntervalMs =
      endpoint.pollIntervalMs ?? pollIntervalMsForRps(maxPerSec);
    const limiter = new TokenBucketRateLimiter(maxPerSec, maxPerSec);
    const state: EndpointWorkerState = { stopped: false, timer: null };

    void pollEndpoint(
      env,
      db,
      endpoint.key,
      endpoint.method,
      endpoint.path,
      pollIntervalMs,
      state,
      limiter,
    );

    handles.push({
      stop: () => {
        state.stopped = true;
        if (state.timer) {
          clearTimeout(state.timer);
        }
      },
    });
  }

  return handles;
}
