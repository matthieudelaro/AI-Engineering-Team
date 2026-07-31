import { randomUUID } from "node:crypto";
import { tryClaim } from "./claim.js";
import { FOG_PADDING, MAX_PLAYERS, type RejectionReason } from "./constants.js";
import { applyCaptures } from "./enclosure.js";
import { maybeExpand } from "./expand.js";
import { getVisibleForPlayer, type FogTile } from "./fog.js";
import { Grid } from "./grid.js";
import { launchNuke } from "./nuke.js";

export interface PlayerRecord {
  id: number;
  externalId: string;
  displayName: string;
  color: string;
}

export interface FlagRecord {
  id: string;
  x: number;
  y: number;
  pot: number;
  nuked: boolean;
  ownerId: number | null;
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
  accepted: { action_id: string };
}

export interface ActionRejectedResponse {
  rejected: { reason: string; retry_after: number };
}

let eventCounter = 0;

function nextEventId(): string {
  eventCounter += 1;
  return String(eventCounter);
}

export function buildAcceptedResponse(actionId?: string): ActionAcceptedResponse {
  return { accepted: { action_id: actionId ?? randomUUID() } };
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

  private constructor(id: string, grid: Grid) {
    this.id = id;
    this.grid = grid;
  }

  /** Subscribe to live events (SSE). Returns unsubscribe. */
  subscribe(listener: (event: GameEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  static create(id: string): GameSession {
    return new GameSession(id, Grid.createInitial(11));
  }

  static createSeeded(id: string): GameSession {
    eventCounter = 0;
    return GameSession.create(id);
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

    this.syncFlagsWithGrid();

    if (maybeExpand(this.grid)) {
      events.push(
        this.makeEvent("map_expanded", {
          width: this.grid.width,
          height: this.grid.height,
          bounds: this.grid.bounds(),
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
    rejection_reason?: RejectionReason;
    events: GameEvent[];
  } {
    if (!this.grid.inBounds(x, y)) {
      return {
        accepted: false,
        cost: 0,
        rejection_reason: "OUT_OF_BOUNDS",
        events: [],
      };
    }
    if (this.grid.getOwner(x, y) !== playerId) {
      return {
        accepted: false,
        cost: 0,
        rejection_reason: "INVALID_TARGET",
        events: [],
      };
    }

    const result = launchNuke(this.grid, x, y);
    this.markFlagsNukedAt(result.hit);
    this.syncFlagsWithGrid();
    this.tick += 1;
    const event = this.makeEvent("nuke_launched", {
      x,
      y,
      player_id: this.displayNameFor(playerId),
      cost: result.cost,
      cells: result.hit,
    });
    this.events.push(event);
    this.emit([event]);
    return { accepted: true, cost: result.cost, events: [event] };
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
    const entries = this.players
      .map((p) => {
        const tileCount = this.grid.playerTileCount(p.id);
        const flagsHeld = this.flagsHeldBy(p.id);
        return {
          display_name: p.displayName,
          is_self: selfExternalId !== undefined && p.externalId === selfExternalId,
          color: p.color,
          tile_count: tileCount,
          flags_held: flagsHeld,
          score: tileCount + flagsHeld * 10,
        };
      })
      .sort((a, b) => b.score - a.score || b.tile_count - a.tile_count);
    return { entries, tick: this.tick };
  }

  getFlags(): FlagsView {
    return {
      flags: this.flags.map((f) => ({
        flag_id: f.id,
        x: f.x,
        y: f.y,
        pot: f.pot,
        nuked: f.nuked,
      })),
    };
  }

  getPlayerStats(displayName: string): Record<string, unknown> | null {
    const player = this.players.find((p) => p.displayName === displayName);
    if (!player) {
      return null;
    }
    const tileCount = this.grid.playerTileCount(player.id);
    const flagsHeld = this.flagsHeldBy(player.id);
    return {
      display_name: player.displayName,
      color: player.color,
      tile_count: tileCount,
      flags_held: flagsHeld,
      score: tileCount + flagsHeld * 10,
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
        pot: f.pot,
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
        pot: flag.pot,
        nuked: flag.nuked,
        ownerId,
      });
    }

    this.syncFlagsWithGrid();
  }

  private flagsHeldBy(playerId: number): number {
    return this.flags.filter((f) => !f.nuked && f.ownerId === playerId).length;
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

  private markFlagsNukedAt(cells: Array<{ x: number; y: number }>): void {
    for (const cell of cells) {
      for (const flag of this.flags) {
        if (flag.x === cell.x && flag.y === cell.y) {
          flag.nuked = true;
        }
      }
    }
  }

  private syncFlagsWithGrid(): void {
    for (const flag of this.flags) {
      if (this.grid.inBounds(flag.x, flag.y) && this.grid.isNuked(flag.x, flag.y)) {
        flag.nuked = true;
      }
      if (this.grid.inBounds(flag.x, flag.y)) {
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
