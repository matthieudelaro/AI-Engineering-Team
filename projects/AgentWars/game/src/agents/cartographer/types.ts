import type { MapResponse } from "../../jobs/shared.js";

export interface Point {
  x: number;
  y: number;
}

export interface CellBelief {
  owner: string | null;
  nuked: boolean;
  lastSeenAt: number;
  /** 0–1; fresh observations start at 1 and decay over time. */
  confidence: number;
}

export interface MapBounds {
  min_x: number;
  min_y: number;
  max_x: number;
  max_y: number;
}

export interface FlagInfo {
  flag_id: string;
  x: number;
  y: number;
  pot: number;
  nuked: boolean;
}

export interface FlagsResponse {
  flags: FlagInfo[];
}

/** Enemy spent their nuke — ~30s window before they can nuke again. */
export interface NukeAttackWindow {
  enemyName: string;
  openedAt: number;
  expiresAt: number;
}

export interface CartographerContext {
  map: MapResponse;
  selfName: string | null;
  bounds: MapBounds;
}

export type ClaimAction =
  | { kind: "scout"; x: number; y: number }
  | { kind: "claim"; x: number; y: number; reason: string }
  | { kind: "nuke"; flagId: string; x: number; y: number }
  | { kind: "idle" };
