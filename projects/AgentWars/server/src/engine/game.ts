import { randomUUID } from "node:crypto";
import { tryClaim } from "./claim.js";
import {
  FOG_PADDING,
  MAX_PLAYERS,
  NUKE_COOLDOWN_MS,
  type RejectionReason,
} from "./constants.js";
import { applyCaptures } from "./enclosure.js";
import { maybeExpand } from "./expand.js";
import {
  computePot,
  materializePot,
  materializePots,
  spawnFlagsInRing,
  type FlagState,
} from "./flags.js";
import { getVisibleForPlayer, type FogTile } from "./fog.js";
import { Grid } from "./grid.js";
import { launchNuke } from "./nuke.js";

export type FlagRecord = FlagState;

export interface PlayerRecord {
  id: number;
  externalId: string;
  displayName: string;
  color: string;
}

export interface GameEvent {
  event_id: string;
  event_type: string;
  tick: number;
  detail: Record<string, unknown>;
  at?: string;
}

export type ApiOwnership = string | { owned: string };

export interface ApiMapTile {
  x: number;
  y: number;
  ownership: ApiOwnership;
  has_flag: boolean;
}

export interface ApiMapView {
  bounds: { min_x: number; min_y: number; max_x: number; max_y: number };
  tiles: ApiMapTile[];
  fog_padding_tiles: number;
}

export interface LeaderboardEntry {
  display_name: string;
  is_self: boolean;
  color: string;
  tile_count: number;
  flags_held: number;
  score: number;
  score_streams?: {
    territory: number;
    flags: number;
    nuke_cost: number;
    scan_cost: number;
    intel_cost: number;
  };
}

export interface LeaderboardView {
  entries: LeaderboardEntry[];
  tick: number;
}

export interface FlagView {
  flag_id: string;
  x: number;
  y: number;
  pot: number;
  nuked: boolean;
  /** Display name of live owner, or locked owner when nuked; null if unclaimed. */
  owner: string | null;
}

export interface FlagsView {
  flags: FlagView[];
}

export interface SnapshotOwnershipCell {
  x: number;
  y: number;
  ownerExternalId: string | null;
  nuked: boolean;
}

export interface SnapshotFlag {
  flag_id: string;
  x: number;
  y: number;
  pot: number;
  nuked: boolean;
  ownerExternalId?: string | null;
}

export interface GameSnapshot {
  tick?: number;
  players: Array<{ externalId: string; displayName: string; color: string }>;
  ownership: SnapshotOwnershipCell[];
  flags: SnapshotFlag[];
}

export interface PlaceTileResult {
  accepted: boolean;
  rejection_reason?: RejectionReason;
  events: GameEvent[];
}

export interface ActionAcceptedResponse {
  accepted: {
    action_id: string;
    accepted_at?: string;
    effect?: {
      launch_id: string;
      effective_radius_tiles: number;
      cost_charged: number;
    };
  };
}

export interface ActionRejectedResponse {
  rejected: { reason: string; retry_after: number };
}

let eventCounter = 0;

function nextEventId(): string {
  eventCounter += 1;
  return String(eventCounter);
}

export function buildAcceptedResponse(
  actionId?: string,
  effect?: ActionAcceptedResponse["accepted"]["effect"],
): ActionAcceptedResponse {
  const accepted: ActionAcceptedResponse["accepted"] = {
    action_id: actionId ?? randomUUID(),
  };
  if (effect) {
    accepted.accepted_at = new Date().toISOString().replace(/\.\d{3}Z$/, "");
    accepted.effect = effect;
  }
  return { accepted };
}

export function buildRejectedResponse(
  reason: RejectionReason | "RATE_LIMITED",
  retryAfter = 0,
): ActionRejectedResponse {
  return {
    rejected: {
      reason: `REJECTION_REASON_${reason}`,
      retry_after: retryAfter,
    },
  };
}

export class GameSession {
  readonly id: string;
  grid: Grid;
  readonly players: PlayerRecord[] = [];
  readonly flags: FlagRecord[] = [];
  tick = 0;
  readonly events: GameEvent[] = [];
  private readonly listeners = new Set<(event: GameEvent) => void>();
  private readonly nukeSpendByPlayer = new Map<number, number>();
  private readonly lastNukeAtMsByPlayer = new Map<number, number>();
  private readonly now: () => number;
  private readonly random: () => number;

  private constructor(
    id: string,
    grid: Grid,
    now: () => number,
    random: () => number,
  ) {
    this.id = id;
    this.grid = grid;
    this.now = now;
    this.random = random;
  }

  /** Subscribe to live events (SSE). Returns unsubscribe. */
  subscribe(listener: (event: GameEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  static create(id: string, now: () => number = Date.now): GameSession {
    return new GameSession(id, Grid.createInitial(11), now, Math.random);
  }

  static createSeeded(
    id: string,
    now: () => number = Date.now,
    random: () => number = Math.random,
  ): GameSession {
    eventCounter = 0;
    return new GameSession(id, Grid.createInitial(11), now, random);
  }

  registerPlayer(
    externalId: string,
    displayName: string,
    color: string,
  ): number | null {
    if (this.players.length >= MAX_PLAYERS) {
      return null;
    }
    const existing = this.players.find((p) => p.externalId === externalId);
    if (existing) {
      return existing.id;
    }
    const id = this.players.length + 1;
    this.players.push({ id, externalId, displayName, color });
    return id;
  }

  findPlayerByExternalId(externalId: string): PlayerRecord | undefined {
    return this.players.find((p) => p.externalId === externalId);
  }

  findPlayerById(playerId: number): PlayerRecord | undefined {
    return this.players.find((p) => p.id === playerId);
  }

  displayNameFor(playerId: number): string {
    return this.findPlayerById(playerId)?.displayName ?? String(playerId);
  }

  placeTile(playerId: number, x: number, y: number): PlaceTileResult {
    const events: GameEvent[] = [];
    const claim = tryClaim(this.grid, playerId, x, y);
    if (!claim.ok) {
      return { accepted: false, rejection_reason: claim.reason, events };
    }

    this.tick += 1;
    const capturerName = this.displayNameFor(playerId);
    events.push(
      this.makeEvent("tile_captured", { x, y, player_id: capturerName }),
    );

    const captures = applyCaptures(this.grid, playerId, x, y);
    for (const capture of captures) {
      const victimName = this.displayNameFor(capture.victim);
      for (const cell of capture.cells) {
        events.push(
          this.makeEvent("tile_captured", {
            x: cell.x,
            y: cell.y,
            player_id: capturerName,
            lasso: true,
            victim: victimName,
          }),
        );
      }
    }

    this.syncFlagsWithGrid(this.now());

    const expansion = maybeExpand(this.grid);
    if (expansion.expanded && expansion.oldBounds) {
      const spawned = spawnFlagsInRing(
        this.grid,
        expansion.oldBounds,
        this.flags,
        this.grid.width,
        this.now(),
        this.random,
      );
      this.flags.push(...spawned);
      events.push(
        this.makeEvent("map_expanded", {
          width: this.grid.width,
          height: this.grid.height,
          bounds: this.grid.bounds(),
          flags_spawned: spawned.length,
        }),
      );
    }

    this.events.push(...events);
    this.emit(events);
    return { accepted: true, events };
  }

  launchNuke(
    playerId: number,
    x: number,
    y: number,
  ): {
    accepted: boolean;
    cost: number;
    radius: number;
    launchId?: string;
    rejection_reason?: RejectionReason;
    retry_after?: number;
    events: GameEvent[];
  } {
    const nowMs = this.now();
    if (!this.grid.inBounds(x, y)) {
      return {
        accepted: false,
        cost: 0,
        radius: 0,
        rejection_reason: "OUT_OF_BOUNDS",
        events: [],
      };
    }
    if (this.grid.playerTileCount(playerId) === 0) {
      return {
        accepted: false,
        cost: 0,
        radius: 0,
        rejection_reason: "INVALID_TARGET",
        events: [],
      };
    }

    const lastNukeAt = this.lastNukeAtMsByPlayer.get(playerId);
    if (lastNukeAt !== undefined) {
      const elapsed = nowMs - lastNukeAt;
      if (elapsed < NUKE_COOLDOWN_MS) {
        const retryAfter = Math.ceil((NUKE_COOLDOWN_MS - elapsed) / 1000);
        return {
          accepted: false,
          cost: 0,
          radius: 0,
          rejection_reason: "COOLDOWN",
          retry_after: retryAfter,
          events: [],
        };
      }
    }

    materializePots(this.flags, nowMs);
    const launchId = randomUUID();
    const result = launchNuke(this.grid, playerId, x, y, launchId);
    this.freezeFlagsNukedAt(result.hit, nowMs);
    this.syncFlagsWithGrid(nowMs);

    const priorSpend = this.nukeSpendByPlayer.get(playerId) ?? 0;
    this.nukeSpendByPlayer.set(playerId, priorSpend + result.cost);
    this.lastNukeAtMsByPlayer.set(playerId, nowMs);

    this.tick += 1;
    const event = this.makeEvent("nuke_launched", {
      x,
      y,
      player_id: this.displayNameFor(playerId),
      cost: result.cost,
      radius: result.radius,
      launch_id: launchId,
      cells: result.hit,
    });
    this.events.push(event);
    this.emit([event]);
    return {
      accepted: true,
      cost: result.cost,
      radius: result.radius,
      launchId,
      events: [event],
    };
  }

  getMapForPlayer(playerId: number): ApiMapView {
    const fog = getVisibleForPlayer(this.grid, playerId);
    return {
      bounds: fog.bounds,
      tiles: fog.tiles.map((t) => this.toApiMapTile(t)),
      fog_padding_tiles: FOG_PADDING,
    };
  }

  getMapSpectator(): ApiMapView {
    const tiles: ApiMapTile[] = [];
    this.grid.forEachCell((x, y, owner, nuked) => {
      tiles.push(this.toApiMapTile({ x, y, owner, nuked }));
    });
    return {
      bounds: this.grid.bounds(),
      tiles,
      fog_padding_tiles: FOG_PADDING,
    };
  }

  getLeaderboard(selfExternalId?: string): LeaderboardView {
    const nowMs = this.now();
    materializePots(this.flags, nowMs);
    const entries = this.players
      .map((p) => this.buildLeaderboardEntry(p, selfExternalId, nowMs))
      .sort((a, b) => b.score - a.score || b.tile_count - a.tile_count);
    return { entries, tick: this.tick };
  }

  getFlags(): FlagsView {
    const nowMs = this.now();
    materializePots(this.flags, nowMs);
    return {
      flags: this.flags.map((f) => ({
        flag_id: f.id,
        x: f.x,
        y: f.y,
        pot: computePot(f, nowMs),
        nuked: f.nuked,
        owner: this.flagOwnerDisplayName(f),
      })),
    };
  }

  getPlayerStats(displayName: string): Record<string, unknown> | null {
    const player = this.players.find((p) => p.displayName === displayName);
    if (!player) {
      return null;
    }
    const nowMs = this.now();
    materializePots(this.flags, nowMs);
    const entry = this.buildLeaderboardEntry(player, undefined, nowMs);
    return {
      display_name: entry.display_name,
      color: entry.color,
      tile_count: entry.tile_count,
      flags_held: entry.flags_held,
      score: entry.score,
      score_streams: entry.score_streams,
      tick: this.tick,
    };
  }

  getEventsAfter(afterEventId?: string): GameEvent[] {
    if (!afterEventId) {
      return [...this.events];
    }
    const index = this.events.findIndex((e) => e.event_id === afterEventId);
    if (index === -1) {
      return [...this.events];
    }
    return this.events.slice(index + 1);
  }

  toSnapshot(): GameSnapshot {
    const nowMs = this.now();
    materializePots(this.flags, nowMs);
    const ownership: SnapshotOwnershipCell[] = [];
    this.grid.forEachCell((x, y, owner, nuked) => {
      ownership.push({
        x,
        y,
        ownerExternalId:
          owner === 0 ? null : (this.findPlayerById(owner)?.externalId ?? null),
        nuked,
      });
    });
    return {
      tick: this.tick,
      players: this.players.map((p) => ({
        externalId: p.externalId,
        displayName: p.displayName,
        color: p.color,
      })),
      ownership,
      flags: this.flags.map((f) => ({
        flag_id: f.id,
        x: f.x,
        y: f.y,
        pot: computePot(f, nowMs),
        nuked: f.nuked,
        ownerExternalId:
          f.ownerId === null
            ? null
            : (this.findPlayerById(f.ownerId)?.externalId ?? null),
      })),
    };
  }

  seedFromSnapshot(snapshot: GameSnapshot): void {
    this.players.length = 0;
    this.flags.length = 0;
    this.events.length = 0;
    this.nukeSpendByPlayer.clear();
    this.lastNukeAtMsByPlayer.clear();
    this.tick = snapshot.tick ?? 0;

    for (const player of snapshot.players) {
      this.registerPlayer(player.externalId, player.displayName, player.color);
    }

    const externalToId = new Map(
      this.players.map((p) => [p.externalId, p.id] as const),
    );

    if (snapshot.ownership.length === 0) {
      this.grid = Grid.createInitial(11);
    } else {
      const minX = Math.min(...snapshot.ownership.map((c) => c.x));
      const minY = Math.min(...snapshot.ownership.map((c) => c.y));
      const maxX = Math.max(...snapshot.ownership.map((c) => c.x));
      const maxY = Math.max(...snapshot.ownership.map((c) => c.y));
      this.grid = Grid.createCovering(minX, minY, maxX, maxY);
    }

    for (const cell of snapshot.ownership) {
      const ownerId =
        cell.ownerExternalId === null
          ? 0
          : (externalToId.get(cell.ownerExternalId) ?? 0);
      if (this.grid.inBounds(cell.x, cell.y)) {
        this.grid.setOwner(cell.x, cell.y, ownerId);
        this.grid.setNuked(cell.x, cell.y, cell.nuked);
      }
    }

    for (const flag of snapshot.flags) {
      const ownerId =
        flag.ownerExternalId === undefined || flag.ownerExternalId === null
          ? null
          : (externalToId.get(flag.ownerExternalId) ?? null);
      this.flags.push({
        id: flag.flag_id,
        x: flag.x,
        y: flag.y,
        frozenPot: flag.pot,
        createdAtMs: this.now(),
        nuked: flag.nuked,
        ownerId,
        lockedOwnerId: flag.nuked ? ownerId : null,
      });
    }

    this.syncFlagsWithGrid(this.now());
  }

  private buildLeaderboardEntry(
    player: PlayerRecord,
    selfExternalId: string | undefined,
    nowMs: number,
  ): LeaderboardEntry {
    const territory = this.grid.playerTileCount(player.id);
    const flagsScore = this.flagPointsFor(player.id, nowMs);
    const nukeCost = -(this.nukeSpendByPlayer.get(player.id) ?? 0);
    const score = territory + flagsScore + nukeCost;
    return {
      display_name: player.displayName,
      is_self: selfExternalId !== undefined && player.externalId === selfExternalId,
      color: player.color,
      tile_count: territory,
      flags_held: this.flagsHeldBy(player.id),
      score,
      score_streams: {
        territory,
        flags: flagsScore,
        nuke_cost: nukeCost,
        scan_cost: 0,
        intel_cost: 0,
      },
    };
  }

  private flagPointsFor(playerId: number, nowMs: number): number {
    let total = 0;
    for (const flag of this.flags) {
      const pot = computePot(flag, nowMs);
      if (!flag.nuked && flag.ownerId === playerId) {
        total += pot;
        continue;
      }
      if (flag.nuked && flag.lockedOwnerId === playerId) {
        total += pot;
      }
    }
    return total;
  }

  private flagsHeldBy(playerId: number): number {
    return this.flags.filter((f) => !f.nuked && f.ownerId === playerId).length;
  }

  private flagOwnerDisplayName(flag: FlagRecord): string | null {
    const ownerId = flag.nuked ? flag.lockedOwnerId : flag.ownerId;
    if (ownerId === null) {
      return null;
    }
    return this.displayNameFor(ownerId);
  }

  private toApiOwnership(owner: number, nuked: boolean): ApiOwnership {
    if (nuked) {
      return "nuked";
    }
    if (owner === 0) {
      return "";
    }
    return { owned: this.displayNameFor(owner) };
  }

  private toApiMapTile(tile: FogTile): ApiMapTile {
    return {
      x: tile.x,
      y: tile.y,
      ownership: this.toApiOwnership(tile.owner, tile.nuked),
      has_flag: this.hasActiveFlagAt(tile.x, tile.y),
    };
  }

  private hasActiveFlagAt(x: number, y: number): boolean {
    return this.flags.some((f) => f.x === x && f.y === y && !f.nuked);
  }

  private freezeFlagsNukedAt(
    cells: Array<{ x: number; y: number }>,
    nowMs: number,
  ): void {
    for (const cell of cells) {
      for (const flag of this.flags) {
        if (flag.x !== cell.x || flag.y !== cell.y || flag.nuked) {
          continue;
        }
        materializePot(flag, nowMs);
        flag.nuked = true;
        flag.lockedOwnerId = flag.ownerId;
      }
    }
  }

  private syncFlagsWithGrid(nowMs: number): void {
    materializePots(this.flags, nowMs);
    for (const flag of this.flags) {
      if (this.grid.inBounds(flag.x, flag.y) && this.grid.isNuked(flag.x, flag.y)) {
        if (!flag.nuked) {
          materializePot(flag, nowMs);
          flag.nuked = true;
          flag.lockedOwnerId = flag.ownerId;
        }
      }
      if (!flag.nuked && this.grid.inBounds(flag.x, flag.y)) {
        const owner = this.grid.getOwner(flag.x, flag.y);
        flag.ownerId = owner === 0 ? null : owner;
      }
    }
  }

  private makeEvent(
    eventType: string,
    detail: Record<string, unknown>,
  ): GameEvent {
    return {
      event_id: nextEventId(),
      event_type: eventType,
      tick: this.tick,
      detail,
      at: new Date().toISOString().replace(/\.\d{3}Z$/, ""),
    };
  }

  private emit(events: GameEvent[]): void {
    for (const event of events) {
      for (const listener of this.listeners) {
        listener(event);
      }
    }
  }
}
