/** Target place-tile requests per second (API cap 20, pace at cap-1). */
export const TARGET_PLACE_RPS = 19;

/** Reserved scout probe rate (place-tile budget). */
export const SCOUT_RPS = 1;

/** Claim budget after scout reservation. */
export const CLAIM_RPS = TARGET_PLACE_RPS - SCOUT_RPS;

export type BudgetChannel = "scout" | "claim" | "flag";

export interface BudgetTick {
  channel: BudgetChannel;
  /** Whether this tick should issue a scout probe. */
  scout: boolean;
  /** Whether this tick should prefer flag-hunter claim. */
  flagPriority: boolean;
}

/**
 * Simple round-robin scheduler: ~1 scout per TARGET_PLACE_RPS ticks,
 * remainder for claim pipeline (lasso / hole-fill / random).
 */
export function nextBudgetTick(tickIndex: number): BudgetTick {
  const scout = tickIndex % TARGET_PLACE_RPS === 0;
  return {
    channel: scout ? "scout" : "claim",
    scout,
    flagPriority: false,
  };
}

/** Milliseconds between scout probes at SCOUT_RPS. */
export function scoutIntervalMs(): number {
  return Math.ceil(1000 / SCOUT_RPS);
}

/** Milliseconds between claim attempts at CLAIM_RPS. */
export function claimIntervalMs(): number {
  return Math.ceil(1000 / CLAIM_RPS);
}
