import type { Env } from "../config.js";
import { GameClient } from "../client/gameClient.js";
import type { Database } from "../db/index.js";
import type { TokenBucketRateLimiter } from "../pollers/rateLimiter.js";
import { pickClaimTarget, type Point } from "./claimStrategy.js";
import {
  ackUiClaims,
  findNextAdjacentUiClaimIndex,
  logJobEvent,
  markTileOwned,
  msUntilRateLimitReset,
  partitionBySelfOwnership,
  pickBridgeStepToward,
  PLACE_TILE_WORKER_COUNT,
  placeTile,
  requeueUiClaims,
  retryUiClaim,
  takeUiClaimQueue,
  type MapResponse,
  type PlaceTileResult,
  type SelfContext,
  type UiClaimQueueTile,
} from "./shared.js";

export { PLACE_TILE_WORKER_COUNT };

const ALLOC_IDLE_MS = 15;
const UI_REFILL_BATCH = 60;

export function isInvalidTarget(reason: string | undefined): boolean {
  return reason?.includes("INVALID_TARGET") ?? false;
}

export type PlaceTileOutcome =
  | { action: "success" }
  | { action: "retry_rate_limit"; waitMs: number }
  | { action: "give_up" }
  | { action: "soft_retry" };

/** Decide what a worker should do after one place-tile attempt. */
export function resolvePlaceTileOutcome(
  result: PlaceTileResult,
  fromUiQueue: boolean,
  isRetry: boolean,
): PlaceTileOutcome {
  if (result.ok) {
    return { action: "success" };
  }

  if (result.rateLimited) {
    return {
      action: "retry_rate_limit",
      waitMs: msUntilRateLimitReset(
        result.rateLimitReset,
        result.rejected?.retry_after,
      ),
    };
  }

  const reason = result.rejected?.reason ?? "";
  if (isInvalidTarget(reason)) {
    return { action: "give_up" };
  }

  if (fromUiQueue && !isRetry) {
    return { action: "soft_retry" };
  }

  return { action: "give_up" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function releasePending(ctx: WorkerContext, x: number, y: number): void {
  ctx.pendingClaims.delete(cellKey(x, y));
}

function reserveCell(ctx: WorkerContext, x: number, y: number): void {
  ctx.pendingClaims.add(cellKey(x, y));
}

function swapToFront<T>(arr: T[], fromIndex: number, index: number): T {
  if (index !== fromIndex) {
    const tmp = arr[fromIndex]!;
    arr[fromIndex] = arr[index]!;
    arr[index] = tmp;
  }
  return arr[fromIndex]!;
}

interface ClaimTask {
  x: number;
  y: number;
  fromUiQueue: boolean;
  isRetry: boolean;
}

export interface WorkerContext {
  env: Env;
  db: Database;
  client: GameClient;
  limiter: TokenBucketRateLimiter;
  map: MapResponse;
  self: SelfContext;
  recordSuccess: (x: number, y: number) => void;
  /** Shared mutable ownership set — keep in sync on every successful claim. */
  ownedSet: Set<string>;
  /** Cells reserved by in-flight workers (avoid duplicate place-tile). */
  pendingClaims: Set<string>;
}

class UiClaimAllocator {
  private chain = Promise.resolve();
  private work: UiClaimQueueTile[] = [];
  private nextIndex = 0;
  private activeClaims = 0;
  private done = false;
  private readonly toAck: Point[] = [];
  private readonly toRequeue: Point[] = [];
  private readonly ownedSet: Set<string>;
  private readonly pendingClaims: Set<string>;

  constructor(
    private readonly env: Env,
    private readonly map: MapResponse,
    private readonly self: SelfContext,
    initialBatch: UiClaimQueueTile[],
    ownedSet: Set<string>,
    pendingClaims: Set<string>,
  ) {
    this.ownedSet = ownedSet;
    this.pendingClaims = pendingClaims;
    this.ingestSync(initialBatch);
  }

  noteOwned(x: number, y: number): void {
    this.ownedSet.add(`${x},${y}`);
    if (this.self.name) {
      markTileOwned(this.map, this.self.name, x, y);
    }
  }

  private ingestSync(batch: UiClaimQueueTile[]): void {
    const { claimable, alreadyOwned } = partitionBySelfOwnership(
      batch,
      this.map,
      this.self.name,
    );
    for (const tile of alreadyOwned) {
      this.toAck.push({ x: tile.x, y: tile.y });
    }
    this.work.push(...claimable);
  }

  private withLock<T>(fn: () => Promise<T> | T): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  trackStart(): void {
    this.activeClaims += 1;
  }

  trackEnd(): void {
    this.activeClaims = Math.max(0, this.activeClaims - 1);
  }

  ackTile(x: number, y: number): void {
    this.toAck.push({ x, y });
  }

  requeueTile(x: number, y: number): void {
    this.toRequeue.push({ x, y });
  }

  isFinished(): boolean {
    return this.done && this.activeClaims === 0;
  }

  async acquireTask(): Promise<ClaimTask | null> {
    return this.withLock(async () => {
      if (this.done) {
        return null;
      }

      const task = this.pickTaskLocked();
      if (task) {
        return task;
      }

      const more = await takeUiClaimQueue(this.env, UI_REFILL_BATCH);
      if (more.length > 0) {
        this.ingestSync(more);
        return this.pickTaskLocked();
      }

      if (this.activeClaims > 0) {
        return null;
      }

      if (this.nextIndex < this.work.length) {
        this.done = true;
        return null;
      }

      this.done = true;
      return null;
    });
  }

  async flush(): Promise<void> {
    const notStarted = this.work.slice(this.nextIndex).map((t) => ({ x: t.x, y: t.y }));
    const putBack = [...this.toRequeue, ...notStarted];
    if (putBack.length > 0) {
      await requeueUiClaims(this.env, putBack);
    }
    if (this.toAck.length > 0) {
      void ackUiClaims(this.env, this.toAck);
    }
  }

  private pickTaskLocked(): ClaimTask | null {
    if (this.nextIndex >= this.work.length) {
      return null;
    }

    const adjacentIndex = findNextAdjacentUiClaimIndex(
      this.work,
      this.nextIndex,
      this.map,
      this.self.name,
      this.ownedSet,
    );

    if (adjacentIndex !== null) {
      const tile = swapToFront(this.work, this.nextIndex, adjacentIndex);
      this.nextIndex += 1;
      const k = cellKey(tile.x, tile.y);
      if (this.ownedSet.has(k) || this.pendingClaims.has(k)) {
        return null;
      }
      this.pendingClaims.add(k);
      return {
        x: tile.x,
        y: tile.y,
        fromUiQueue: true,
        isRetry: tile.isRetry,
      };
    }

    if (this.activeClaims > 0) {
      return null;
    }

    const remaining = this.work.slice(this.nextIndex);
    const bridge = pickBridgeStepToward(
      this.map,
      this.self.name,
      remaining.map((t) => ({ x: t.x, y: t.y })),
      this.ownedSet,
      this.pendingClaims,
    );
    if (!bridge) {
      return null;
    }

    const bridgeKey = cellKey(bridge.x, bridge.y);
    if (this.ownedSet.has(bridgeKey) || this.pendingClaims.has(bridgeKey)) {
      return null;
    }
    this.pendingClaims.add(bridgeKey);

    const queuedIdx = remaining.findIndex(
      (t) => t.x === bridge.x && t.y === bridge.y,
    );
    if (queuedIdx !== -1) {
      const absIndex = this.nextIndex + queuedIdx;
      const tile = swapToFront(this.work, this.nextIndex, absIndex);
      this.nextIndex += 1;
      return {
        x: tile.x,
        y: tile.y,
        fromUiQueue: true,
        isRetry: tile.isRetry,
      };
    }

    return {
      x: bridge.x,
      y: bridge.y,
      fromUiQueue: false,
      isRetry: false,
    };
  }
}

async function runClaimTask(
  ctx: WorkerContext,
  task: ClaimTask,
  allocator: UiClaimAllocator | null,
): Promise<{ placed: boolean; rateLimitWaitMs: number }> {
  const current = task;
  let rateLimitWaitMs = 0;
  const k = cellKey(current.x, current.y);

  if (ctx.ownedSet.has(k)) {
    if (current.fromUiQueue && allocator) {
      allocator.ackTile(current.x, current.y);
    }
    releasePending(ctx, current.x, current.y);
    return { placed: false, rateLimitWaitMs };
  }

  while (true) {
    await ctx.limiter.acquire();
    let result: PlaceTileResult;
    try {
      result = await placeTile(ctx.client, null, ctx.env.GAME_ID, current.x, current.y);
    } catch (error) {
      const message = error instanceof Error ? error.message : "claim fetch failed";
      await logJobEvent(ctx.db, "error", "claim_fetch_error", message, {
        x: current.x,
        y: current.y,
        fromUiQueue: current.fromUiQueue,
      });
      if (current.fromUiQueue && allocator) {
        allocator.requeueTile(current.x, current.y);
      }
      releasePending(ctx, current.x, current.y);
      return { placed: false, rateLimitWaitMs };
    }

    const outcome = resolvePlaceTileOutcome(
      result,
      current.fromUiQueue,
      current.isRetry,
    );

    if (outcome.action === "retry_rate_limit") {
      // Coordinated pause — do not sleep per-worker (that stampeded and capped ~10/s).
      ctx.limiter.pauseFor(outcome.waitMs);
      rateLimitWaitMs = Math.max(rateLimitWaitMs, outcome.waitMs);
      await logJobEvent(
        ctx.db,
        "warn",
        "claim_rate_limited",
        result.rejected?.reason ?? "rate limited",
        {
          x: current.x,
          y: current.y,
          fromUiQueue: current.fromUiQueue,
          rateLimitReset: result.rateLimitReset,
        },
      );
      continue;
    }

    if (outcome.action === "success") {
      ctx.ownedSet.add(`${current.x},${current.y}`);
      if (allocator) {
        allocator.noteOwned(current.x, current.y);
      } else if (ctx.self.name) {
        markTileOwned(ctx.map, ctx.self.name, current.x, current.y);
      }
      ctx.recordSuccess(current.x, current.y);
      if (current.fromUiQueue && allocator) {
        allocator.ackTile(current.x, current.y);
      }
      releasePending(ctx, current.x, current.y);
      return { placed: true, rateLimitWaitMs };
    }

    if (outcome.action === "soft_retry") {
      await logJobEvent(ctx.db, "warn", "claim_rejected", result.rejected!.reason, {
        x: current.x,
        y: current.y,
        fromUiQueue: true,
      });
      void retryUiClaim(ctx.env, current.x, current.y);
      releasePending(ctx, current.x, current.y);
      return { placed: false, rateLimitWaitMs };
    }

    await logJobEvent(ctx.db, "warn", "claim_rejected", result.rejected!.reason, {
      x: current.x,
      y: current.y,
      fromUiQueue: current.fromUiQueue,
    });
    if (current.fromUiQueue && allocator) {
      // Keep INVALID_TARGET in the queue until the frontier reaches it.
      if (isInvalidTarget(result.rejected?.reason)) {
        allocator.requeueTile(current.x, current.y);
      } else {
        allocator.ackTile(current.x, current.y);
      }
    }
    releasePending(ctx, current.x, current.y);
    return { placed: false, rateLimitWaitMs };
  }
}

async function uiClaimWorker(
  ctx: WorkerContext,
  allocator: UiClaimAllocator,
): Promise<{ placed: number; rateLimitWaitMs: number }> {
  let placed = 0;
  let rateLimitWaitMs = 0;

  while (!allocator.isFinished()) {
    const task = await allocator.acquireTask();
    if (!task) {
      if (allocator.isFinished()) {
        break;
      }
      await sleep(ALLOC_IDLE_MS);
      continue;
    }

    allocator.trackStart();
    try {
      const result = await runClaimTask(ctx, task, allocator);
      placed += result.placed ? 1 : 0;
      rateLimitWaitMs = Math.max(rateLimitWaitMs, result.rateLimitWaitMs);
    } finally {
      allocator.trackEnd();
    }
  }

  return { placed, rateLimitWaitMs };
}

/** Drain the UI claim queue with a fixed pool of place-tile workers. */
export async function runUiQueueWorkers(
  ctx: WorkerContext,
  initialBatch: UiClaimQueueTile[],
): Promise<{ delayMs: number; placed: number }> {
  const allocator = new UiClaimAllocator(
    ctx.env,
    ctx.map,
    ctx.self,
    initialBatch,
    ctx.ownedSet,
    ctx.pendingClaims,
  );

  const results = await Promise.all(
    Array.from({ length: PLACE_TILE_WORKER_COUNT }, () =>
      uiClaimWorker(ctx, allocator),
    ),
  );

  await allocator.flush();

  let placed = 0;
  let delayMs = 0;
  for (const result of results) {
    placed += result.placed;
    delayMs = Math.max(delayMs, result.rateLimitWaitMs);
  }

  return { delayMs, placed };
}

class AutoClaimAllocator {
  private chain = Promise.resolve();
  private stop = false;

  constructor(
    private readonly map: MapResponse,
    private readonly self: SelfContext,
    private readonly recentClaims: Point[],
    private readonly ownedSet: Set<string>,
    private readonly pendingClaims: Set<string>,
    private readonly shouldStop: () => Promise<boolean>,
  ) {}

  private withLock<T>(fn: () => Promise<T> | T): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async acquireTask(): Promise<ClaimTask | null> {
    return this.withLock(async () => {
      if (this.stop) {
        return null;
      }
      if (await this.shouldStop()) {
        this.stop = true;
        return null;
      }

      for (let attempt = 0; attempt < 32; attempt += 1) {
        const target = pickClaimTarget(
          this.map,
          this.self,
          this.recentClaims,
          this.ownedSet,
          this.pendingClaims,
        );
        if (!target) {
          this.stop = true;
          return null;
        }
        const k = cellKey(target.x, target.y);
        if (this.ownedSet.has(k) || this.pendingClaims.has(k)) {
          continue;
        }
        this.pendingClaims.add(k);
        return {
          x: target.x,
          y: target.y,
          fromUiQueue: false,
          isRetry: false,
        };
      }

      this.stop = true;
      return null;
    });
  }

  isStopped(): boolean {
    return this.stop;
  }
}

async function autoClaimWorker(
  ctx: WorkerContext,
  allocator: AutoClaimAllocator,
): Promise<{ placed: number; rateLimitWaitMs: number }> {
  let placed = 0;
  let rateLimitWaitMs = 0;

  while (!allocator.isStopped()) {
    const task = await allocator.acquireTask();
    if (!task) {
      break;
    }

    const result = await runClaimTask(ctx, task, null);
    placed += result.placed ? 1 : 0;
    rateLimitWaitMs = Math.max(rateLimitWaitMs, result.rateLimitWaitMs);
  }

  return { placed, rateLimitWaitMs };
}

/** Automatic claiming with the same worker pool (no UI queue). */
export async function runAutoClaimWorkers(
  ctx: WorkerContext,
  recentClaims: Point[],
  shouldStop: () => Promise<boolean>,
): Promise<{ delayMs: number; placed: number }> {
  const allocator = new AutoClaimAllocator(
    ctx.map,
    ctx.self,
    recentClaims,
    ctx.ownedSet,
    ctx.pendingClaims,
    shouldStop,
  );

  const results = await Promise.all(
    Array.from({ length: PLACE_TILE_WORKER_COUNT }, () =>
      autoClaimWorker(ctx, allocator),
    ),
  );

  let placed = 0;
  let delayMs = 0;
  for (const result of results) {
    placed += result.placed;
    delayMs = Math.max(delayMs, result.rateLimitWaitMs);
  }

  return { delayMs, placed };
}
