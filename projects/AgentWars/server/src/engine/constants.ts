export const SIZE_LADDER = [
  11, 26, 34, 45, 59, 77, 101, 132, 172, 224, 292, 300,
] as const;

export const FOG_PADDING = 3;
export const MAX_PLAYERS = 8;
export const EXPAND_THRESHOLD = 0.7;

/** Empty cell — no player ownership. */
export const EMPTY = 0;

/** Map edge acts as a sealing wall for lasso captures. */
export const ALLOW_MAP_EDGE_AS_WALL = true;

export const ORTHOGONAL_DELTAS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
] as const;

export type RejectionReason = "INVALID_TARGET" | "OUT_OF_BOUNDS";

export type PlayerId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
