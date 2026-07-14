import type { MapResponse, Tile } from "./types.js";

export interface MapStreamEvent {
  event_id: string;
  event_type: string;
  detail: Record<string, unknown>;
  at?: string | null;
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

export function applyMapStreamEvent(
  map: MapResponse,
  tileIndex: Map<string, Tile>,
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

  map.bounds.min_x = Math.min(map.bounds.min_x, x);
  map.bounds.min_y = Math.min(map.bounds.min_y, y);
  map.bounds.max_x = Math.max(map.bounds.max_x, x);
  map.bounds.max_y = Math.max(map.bounds.max_y, y);

  const key = `${x},${y}`;
  const tile: Tile = {
    x,
    y,
    ownership: { owned: owner },
    has_flag: tileIndex.get(key)?.has_flag ?? false,
  };
  const existed = tileIndex.has(key);
  tileIndex.set(key, tile);
  if (!existed) {
    map.tiles.push(tile);
  }

  return true;
}

export interface MapStreamSubscription {
  close: () => void;
}

export interface MapStreamHandlers {
  onBatch: (events: MapStreamEvent[]) => void;
  onOffline?: (detail: string, status?: number) => void;
  onConnected?: () => void;
}

export function subscribeMapStream(
  streamUrl: string,
  handlers: MapStreamHandlers,
  options?: { startAfterEventId?: string },
): MapStreamSubscription {
  const { onBatch, onOffline, onConnected } = handlers;
  const controller = new AbortController();
  let afterEventId = options?.startAfterEventId ?? "";
  let closed = false;
  const pending: MapStreamEvent[] = [];
  let flushScheduled = false;

  const flushPending = (): void => {
    flushScheduled = false;
    if (pending.length === 0) {
      return;
    }
    const batch = pending.splice(0, pending.length);
    onBatch(batch);
  };

  const enqueueEvents = (events: MapStreamEvent[]): void => {
    for (const event of events) {
      afterEventId = event.event_id;
      pending.push(event);
    }
    if (!flushScheduled) {
      flushScheduled = true;
      requestAnimationFrame(flushPending);
    }
  };

  const connect = async (): Promise<void> => {
    while (!closed) {
      const query = afterEventId
        ? `?after_event_id=${encodeURIComponent(afterEventId)}`
        : "";
      try {
        const response = await fetch(`${streamUrl}${query}`, {
          headers: {
            Accept: "text/event-stream",
            "X-Source": "ui",
          },
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          onOffline?.(`map stream failed (${response.status})`, response.status);
          await new Promise((resolve) => setTimeout(resolve, 3000));
          continue;
        }

        onConnected?.();

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!closed) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const { events, remainder } = parseSseEvents(buffer);
          buffer = remainder;

          if (events.length > 0) {
            enqueueEvents(events);
          }
        }

        if (!closed) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (error) {
        if (closed || controller.signal.aborted) {
          return;
        }
        const message = error instanceof Error ? error.message : "map stream error";
        onOffline?.(message, 0);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  };

  void connect();

  return {
    close: () => {
      closed = true;
      controller.abort();
    },
  };
}
