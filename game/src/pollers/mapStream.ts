import { createHash } from "node:crypto";
import type { Env } from "../config.js";
import { getGatewayBaseUrl } from "../config.js";
import { GameClient } from "../client/gameClient.js";
import type { Database } from "../db/index.js";
import { gameStates, policyEvents } from "../db/schema.js";
import { isUsableGameStatePayload } from "../state/usablePayload.js";

export interface MapTile {
  x: number;
  y: number;
  ownership: string | Record<string, unknown>;
  has_flag: boolean;
}

export interface MapResponse {
  bounds: { min_x: number; min_y: number; max_x: number; max_y: number };
  tiles: MapTile[];
  fog_padding_tiles: number;
}

export interface MapStreamEvent {
  event_id: string;
  event_type: string;
  detail: Record<string, unknown>;
  at?: string | null;
}

interface MapState {
  bounds: { min_x: number; min_y: number; max_x: number; max_y: number };
  tiles: Map<string, MapTile>;
  fog_padding_tiles: number;
}

export interface MapStreamHandle {
  stop: () => void;
}

/** After the last replay batch, wait this long before applying live stream events. */
export const MAP_STREAM_CATCH_UP_IDLE_MS = 500;

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function hashPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function playerFromDetail(detail: Record<string, unknown>): string | null {
  const playerId = detail.player_id;
  if (typeof playerId === "string" && playerId !== "") {
    return playerId;
  }
  if (typeof playerId === "object" && playerId !== null && "value" in playerId) {
    const value = (playerId as { value: unknown }).value;
    return typeof value === "string" && value !== "" ? value : null;
  }
  return null;
}

export function parseSseEvents(buffer: string): {
  events: MapStreamEvent[];
  remainder: string;
} {
  const events: MapStreamEvent[] = [];
  const lines = buffer.split("\n");
  let remainder = "";
  let dataLine: string | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const isLast = index === lines.length - 1;

    if (line.startsWith("data:")) {
      dataLine = line.slice(5).trimStart();
      if (isLast && !buffer.endsWith("\n")) {
        remainder = line;
        dataLine = null;
      }
      continue;
    }

    if (line === "" && dataLine !== null) {
      try {
        events.push(JSON.parse(dataLine) as MapStreamEvent);
      } catch {
        // ignore malformed SSE payloads
      }
      dataLine = null;
      continue;
    }

    if (isLast && line !== "" && dataLine === null) {
      remainder = line;
    }
  }

  return { events, remainder };
}

export function mapResponseToState(map: MapResponse): MapState {
  const tiles = new Map<string, MapTile>();
  for (const tile of map.tiles) {
    tiles.set(cellKey(tile.x, tile.y), {
      x: tile.x,
      y: tile.y,
      ownership: tile.ownership,
      has_flag: tile.has_flag ?? false,
    });
  }
  return {
    bounds: { ...map.bounds },
    tiles,
    fog_padding_tiles: map.fog_padding_tiles ?? 0,
  };
}

/** Replace in-memory map state from an authoritative GET /map snapshot. */
export function replaceMapStateFromSnapshot(
  snapshot: MapResponse,
): MapState {
  return mapResponseToState(snapshot);
}

export function mapStateToResponse(state: MapState): MapResponse {
  return {
    bounds: { ...state.bounds },
    tiles: [...state.tiles.values()],
    fog_padding_tiles: state.fog_padding_tiles,
  };
}

function expandBounds(
  bounds: MapState["bounds"],
  x: number,
  y: number,
): void {
  bounds.min_x = Math.min(bounds.min_x, x);
  bounds.min_y = Math.min(bounds.min_y, y);
  bounds.max_x = Math.max(bounds.max_x, x);
  bounds.max_y = Math.max(bounds.max_y, y);
}

export function applyMapStreamEvent(
  state: MapState,
  event: MapStreamEvent,
): boolean {
  if (event.event_type !== "tile_captured") {
    return false;
  }

  const x = event.detail.x;
  const y = event.detail.y;
  if (typeof x !== "number" || typeof y !== "number") {
    return false;
  }

  const owner = playerFromDetail(event.detail);
  if (!owner) {
    return false;
  }

  expandBounds(state.bounds, x, y);
  const key = cellKey(x, y);
  const existing = state.tiles.get(key);
  state.tiles.set(key, {
    x,
    y,
    ownership: { owned: owner },
    has_flag: existing?.has_flag ?? false,
  });
  return true;
}

async function logMapStreamEvent(
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

async function persistMapState(
  db: Database,
  state: MapState,
  previousHash: string | null,
): Promise<string> {
  const payload = mapStateToResponse(state);
  if (payload.tiles.length === 0 || !isUsableGameStatePayload("map", payload)) {
    return previousHash ?? hashPayload(payload);
  }
  const payloadHash = hashPayload(payload);
  if (payloadHash === previousHash) {
    return payloadHash;
  }

  await db.insert(gameStates).values({
    endpointKey: "map",
    payloadJson: payload,
    etagOrHash: payloadHash,
  });
  return payloadHash;
}

async function fetchInitialMap(
  client: GameClient,
  snapshotPath: string,
): Promise<MapResponse | null> {
  const response = await client.get(snapshotPath);
  if (response.status !== 200) {
    return null;
  }
  return response.json() as MapResponse;
}

export async function startMapStream(
  env: Env,
  db: Database,
  snapshotPath: string,
  streamPath: string,
  snapshotIntervalMs = 5000,
): Promise<MapStreamHandle> {
  const stopped = { value: false };
  let afterEventId = "";
  let latestHash: string | null = null;
  let mapState: MapState | null = null;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  let catchUpTimer: ReturnType<typeof setTimeout> | null = null;
  let snapshotTimer: ReturnType<typeof setInterval> | null = null;
  let dirty = false;
  let streamCatchingUp = false;

  const flushPersist = async (force = false): Promise<void> => {
    persistTimer = null;
    if (!mapState) {
      return;
    }
    if (!force && !dirty) {
      return;
    }
    dirty = false;
    latestHash = await persistMapState(
      db,
      mapState,
      force ? null : latestHash,
    );
  };

  const schedulePersist = (): void => {
    dirty = true;
    if (persistTimer) {
      return;
    }
    persistTimer = setTimeout(() => {
      void flushPersist();
    }, 500);
  };

  const scheduleCatchUpEnd = (): void => {
    if (catchUpTimer) {
      clearTimeout(catchUpTimer);
    }
    catchUpTimer = setTimeout(() => {
      catchUpTimer = null;
      streamCatchingUp = false;
    }, MAP_STREAM_CATCH_UP_IDLE_MS);
  };

  const beginCatchUp = (): void => {
    streamCatchingUp = true;
    scheduleCatchUpEnd();
  };

  const reconcileFromSnapshot = async (): Promise<void> => {
    if (stopped.value) {
      return;
    }
    const client = new GameClient(env, { source: "poller" });
    const snapshot = await fetchInitialMap(client, snapshotPath);
    if (!snapshot?.tiles?.length) {
      return;
    }
    mapState = replaceMapStateFromSnapshot(snapshot);
    await flushPersist(true);
    await logMapStreamEvent(db, "info", "map_stream_reconcile", "replaced map from live snapshot", {
      tiles: snapshot.tiles.length,
    });
  };

  const bootstrap = async (): Promise<boolean> => {
    const client = new GameClient(env, { source: "poller" });
    const snapshot = await fetchInitialMap(client, snapshotPath);
    if (!snapshot?.tiles?.length) {
      await logMapStreamEvent(db, "warn", "map_stream_bootstrap_failed", "initial map fetch returned no tiles");
      return false;
    }
    mapState = replaceMapStateFromSnapshot(snapshot);
    latestHash = await persistMapState(db, mapState, null);
    beginCatchUp();
    await logMapStreamEvent(db, "info", "map_stream_bootstrap", "loaded initial map snapshot", {
      tiles: snapshot.tiles.length,
    });
    return true;
  };

  snapshotTimer = setInterval(() => {
    void reconcileFromSnapshot();
  }, snapshotIntervalMs);

  const consumeStream = async (): Promise<void> => {
    while (!stopped.value) {
      if (!mapState) {
        const ready = await bootstrap();
        if (!ready) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          continue;
        }
      }

      const resumingLiveStream = afterEventId !== "";
      if (!resumingLiveStream) {
        beginCatchUp();
      }

      const query = afterEventId
        ? `?after_event_id=${encodeURIComponent(afterEventId)}`
        : "";
      const url = `${getGatewayBaseUrl(env)}${streamPath}${query}`;

      try {
        const response = await fetch(url, {
          headers: {
            "x-source": "poller",
            accept: "text/event-stream",
          },
        });

        if (response.status === 429 || response.status >= 500) {
          await logMapStreamEvent(db, "warn", "map_stream_backoff", "stream reconnect backoff", {
            status: response.status,
          });
          await new Promise((resolve) => setTimeout(resolve, response.status === 429 ? 5000 : 3000));
          continue;
        }

        if (!response.ok || !response.body) {
          await logMapStreamEvent(db, "warn", "map_stream_error", "stream connection failed", {
            status: response.status,
          });
          await new Promise((resolve) => setTimeout(resolve, 3000));
          continue;
        }

        await logMapStreamEvent(db, "info", "map_stream_connected", "map stream connected", {
          afterEventId: afterEventId || null,
          resumingLiveStream,
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!stopped.value) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const { events, remainder } = parseSseEvents(buffer);
          buffer = remainder;

          for (const event of events) {
            afterEventId = event.event_id;
            if (streamCatchingUp) {
              scheduleCatchUpEnd();
              continue;
            }
            if (mapState && applyMapStreamEvent(mapState, event)) {
              schedulePersist();
            }
          }
        }

        await flushPersist();
        await logMapStreamEvent(db, "info", "map_stream_reconnect", "stream ended, reconnecting");
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown stream error";
        await logMapStreamEvent(db, "error", "map_stream_error", message);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  };

  void consumeStream();

  return {
    stop: () => {
      stopped.value = true;
      if (persistTimer) {
        clearTimeout(persistTimer);
      }
      if (catchUpTimer) {
        clearTimeout(catchUpTimer);
      }
      if (snapshotTimer) {
        clearInterval(snapshotTimer);
      }
    },
  };
}
