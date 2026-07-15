/**
 * Gateway-side UI claim queue. The UI enqueues desired tiles; the tileClaimer job
 * drains this queue before its automated strategy. State is process-local.
 *
 * Ordering: strict FIFO — never skip past the head.
 * Dedup: a tile may appear at most once across pending + in-flight.
 */

export const UI_CLAIM_RETRY_WINDOW_MS = 1000;
export const UI_CLAIM_TAKE_DEFAULT_LIMIT = 20;

export interface UiClaimTileInput {
  x: number;
  y: number;
}

export interface UiClaimQueueEntry {
  x: number;
  y: number;
  isRetry: boolean;
  deadlineAt: number | null;
}

export interface UiClaimTakenTile {
  x: number;
  y: number;
  isRetry: boolean;
}

export interface UiClaimQueueHeadTile {
  x: number;
  y: number;
  isRetry: boolean;
}

export interface UiClaimQueueStats {
  pending: number;
  inFlight: number;
  total: number;
  pendingRetries: number;
  head: UiClaimQueueHeadTile[];
}

const HEAD_PREVIEW_LIMIT = 10;

function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

const pending = new Map<string, UiClaimQueueEntry>();
const order: string[] = [];
/** Taken by the job but not yet acked / requeued. */
const inFlight = new Map<string, UiClaimQueueEntry>();
/** Tiles that already consumed their single soft-reject retry attempt. */
const retriedKeys = new Set<string>();

function isExpiredRetry(entry: UiClaimQueueEntry, now: number): boolean {
  return entry.isRetry && entry.deadlineAt !== null && now > entry.deadlineAt;
}

function isDue(entry: UiClaimQueueEntry, now: number): boolean {
  if (!entry.isRetry) {
    return true;
  }
  return entry.deadlineAt !== null && now <= entry.deadlineAt;
}

function isKnown(key: string): boolean {
  return pending.has(key) || inFlight.has(key);
}

/** Enqueue tiles; dedupes against pending and in-flight. Appends in given order. */
export function enqueueUiClaimTiles(tiles: UiClaimTileInput[]): void {
  for (const tile of tiles) {
    const key = tileKey(tile.x, tile.y);
    if (isKnown(key)) {
      continue;
    }
    // Fresh user intent resets the one-retry budget for this tile.
    retriedKeys.delete(key);
    const entry: UiClaimQueueEntry = {
      x: tile.x,
      y: tile.y,
      isRetry: false,
      deadlineAt: null,
    };
    pending.set(key, entry);
    order.push(key);
  }
}

/**
 * Put tiles back at the **front** of the queue (FIFO), e.g. after rate limit or
 * unused take. Clears in-flight; dedupes against pending. Does not burn the
 * soft-reject retry budget.
 */
export function requeueUiClaimTilesFront(tiles: UiClaimTileInput[]): void {
  // Insert in reverse so the first tile becomes the new head.
  for (let i = tiles.length - 1; i >= 0; i--) {
    const tile = tiles[i]!;
    const key = tileKey(tile.x, tile.y);
    inFlight.delete(key);
    if (pending.has(key)) {
      continue;
    }
    const entry: UiClaimQueueEntry = {
      x: tile.x,
      y: tile.y,
      isRetry: false,
      deadlineAt: null,
    };
    pending.set(key, entry);
    order.unshift(key);
  }
}

/** @deprecated alias — prefer requeueUiClaimTilesFront for FIFO */
export function requeueUiClaimTiles(tiles: UiClaimTileInput[]): void {
  requeueUiClaimTilesFront(tiles);
}

/**
 * Dequeue up to `limit` due tiles from the front only (strict FIFO).
 * Moves them to in-flight so enqueue cannot duplicate them.
 * Stops if the head is a retry that is not yet due.
 */
export function takeUiClaimTiles(
  limit: number = UI_CLAIM_TAKE_DEFAULT_LIMIT,
  now: number = Date.now(),
): UiClaimTakenTile[] {
  const taken: UiClaimTakenTile[] = [];

  while (taken.length < limit && order.length > 0) {
    const key = order[0]!;
    const entry = pending.get(key);
    if (!entry) {
      order.shift();
      continue;
    }

    if (isExpiredRetry(entry, now)) {
      pending.delete(key);
      order.shift();
      continue;
    }

    if (!isDue(entry, now)) {
      // Head is not ready — do not skip past it.
      break;
    }

    pending.delete(key);
    order.shift();
    inFlight.set(key, entry);
    taken.push({ x: entry.x, y: entry.y, isRetry: entry.isRetry });
  }

  return taken;
}

/** Mark in-flight tiles as finished (success or final drop). */
export function ackUiClaimTiles(tiles: UiClaimTileInput[]): void {
  for (const tile of tiles) {
    inFlight.delete(tileKey(tile.x, tile.y));
  }
}

/**
 * Re-enqueue a rejected UI-queue tile for one retry within 1s.
 * Returns false if already pending/in-flight or already consumed its retry.
 */
export function scheduleUiClaimRetry(
  x: number,
  y: number,
  now: number = Date.now(),
): boolean {
  const key = tileKey(x, y);
  inFlight.delete(key);
  if (pending.has(key) || retriedKeys.has(key)) {
    return false;
  }

  retriedKeys.add(key);
  const entry: UiClaimQueueEntry = {
    x,
    y,
    isRetry: true,
    deadlineAt: now + UI_CLAIM_RETRY_WINDOW_MS,
  };
  pending.set(key, entry);
  order.push(key);
  return true;
}

/** Snapshot of queue depth and fifo head for the UI. */
export function getUiClaimQueueStats(): UiClaimQueueStats {
  let pendingRetries = 0;
  for (const entry of pending.values()) {
    if (entry.isRetry) {
      pendingRetries += 1;
    }
  }

  const head: UiClaimQueueHeadTile[] = [];
  for (const key of order) {
    if (head.length >= HEAD_PREVIEW_LIMIT) {
      break;
    }
    const entry = pending.get(key);
    if (!entry) {
      continue;
    }
    head.push({ x: entry.x, y: entry.y, isRetry: entry.isRetry });
  }

  const pendingCount = pending.size;
  const inFlightCount = inFlight.size;

  return {
    pending: pendingCount,
    inFlight: inFlightCount,
    total: pendingCount + inFlightCount,
    pendingRetries,
    head,
  };
}

function clearUiClaimQueueState(): void {
  pending.clear();
  order.length = 0;
  inFlight.clear();
  retriedKeys.clear();
}

/** Clear all queue state (pending, in-flight, retry budget). */
export function clearUiClaimQueue(): void {
  clearUiClaimQueueState();
}

/** Reset queue state. Intended for tests. */
export function resetUiClaimQueue(): void {
  clearUiClaimQueueState();
}
