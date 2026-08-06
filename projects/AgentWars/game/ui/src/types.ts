export interface BoundBox {
  min_x: number;
  min_y: number;
  max_x: number;
  max_y: number;
}

export interface Tile {
  x: number;
  y: number;
  ownership: string | Record<string, unknown>;
  has_flag: boolean;
}

export interface MapResponse {
  bounds: BoundBox;
  tiles: Tile[];
  fog_padding_tiles: number;
}

export interface LeaderboardEntry {
  display_name: string;
  is_self: boolean;
  color: string;
  tile_count: number;
  flags_held?: number;
  score?: number;
}

export interface LeaderboardResponse {
  entries: LeaderboardEntry[];
  tick: number;
}

export interface NukeAcceptedEffect {
  cost_charged?: number;
  effective_radius_tiles?: number;
}

export interface ActionResponse {
  accepted?: { action_id: string; effect?: NukeAcceptedEffect };
  rejected?: {
    reason: string;
    retry_after?: number;
    insufficient_points?: { cost?: number; available?: number };
  };
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

export interface PlayerColors {
  selfName: string | null;
  selfColor: string;
  byName: Map<string, string>;
}
