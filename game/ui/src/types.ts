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

export interface ActionResponse {
  accepted?: { action_id: string };
  rejected?: { reason: string; retry_after?: number };
}

export interface PlayerColors {
  selfName: string | null;
  selfColor: string;
  byName: Map<string, string>;
}
