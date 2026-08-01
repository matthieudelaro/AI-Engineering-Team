import { NEIGHBORS } from "../../jobs/shared.js";
import type { FlagInfo, NukeAttackWindow, Point } from "./types.js";

/** Assumed enemy nuke cooldown after they nuke their own flag (ms). */
export const ENEMY_NUKE_WINDOW_MS = 30_000;

export interface FlagTarget {
  flagId: string;
  x: number;
  y: number;
  pot: number;
  owner: string;
}

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function manhattanToOwned(
  x: number,
  y: number,
  owned: Set<string>,
): number {
  if (owned.size === 0) {
    return Math.abs(x) + Math.abs(y);
  }
  let best = Infinity;
  for (const k of owned) {
    const [xs, ys] = k.split(",");
    const dist = Math.abs(x - Number(xs)) + Math.abs(y - Number(ys));
    best = Math.min(best, dist);
  }
  return best;
}

function isAdjacentToOwned(
  x: number,
  y: number,
  owned: Set<string>,
): boolean {
  for (const { dx, dy } of NEIGHBORS) {
    if (owned.has(cellKey(x + dx, y + dy))) {
      return true;
    }
  }
  return false;
}

/** Resolve flag tile owner from map occupancy. */
export function flagOwnersFromMap(
  flags: FlagInfo[],
  occupied: Map<string, string | null>,
): Map<string, string | null> {
  const owners = new Map<string, string | null>();
  for (const f of flags) {
    owners.set(cellKey(f.x, f.y), occupied.get(cellKey(f.x, f.y)) ?? null);
  }
  return owners;
}

/**
 * Pick a cheaper flag owned by `targetOwner` to bait their nuke before the steal.
 */
export function selectFeintTarget(
  flags: FlagInfo[],
  flagOwners: Map<string, string | null>,
  owned: Set<string>,
  targetOwner: string,
  selfName: string,
): FlagTarget | null {
  let best: FlagTarget | null = null;
  for (const f of flags) {
    if (f.nuked) {
      continue;
    }
    const owner = flagOwners.get(cellKey(f.x, f.y));
    if (owner !== targetOwner || owner === selfName) {
      continue;
    }
    if (!best || f.pot < best.pot) {
      best = {
        flagId: f.flag_id,
        x: f.x,
        y: f.y,
        pot: f.pot,
        owner: targetOwner,
      };
    }
  }
  return best;
}

/**
 * High-value enemy flag reasonably close to our territory; skip nuked flags.
 */
export function selectStealTarget(
  flags: FlagInfo[],
  flagOwners: Map<string, string | null>,
  owned: Set<string>,
  selfName: string,
  preferOwner: string | null,
): FlagTarget | null {
  let best: FlagTarget | null = null;
  let bestScore = -Infinity;

  for (const f of flags) {
    if (f.nuked) {
      continue;
    }
    const owner = flagOwners.get(cellKey(f.x, f.y));
    if (!owner || owner === selfName || owner === "neutral") {
      continue;
    }
    if (preferOwner && owner !== preferOwner) {
      continue;
    }
    const dist = manhattanToOwned(f.x, f.y, owned);
    // Prefer nearby flags; pot breaks ties at similar distance.
    const score = f.pot - dist * 50;
    if (score > bestScore) {
      bestScore = score;
      best = {
        flagId: f.flag_id,
        x: f.x,
        y: f.y,
        pot: f.pot,
        owner,
      };
    }
  }
  return best;
}

export class FlagHunter {
  private previousFlags = new Map<string, FlagInfo>();
  private attackWindow: NukeAttackWindow | null = null;
  private feintLaunched = false;
  /** Enemy display name → ms until their nuke is assumed spent (after we observe a nuke). */
  private nukeCooldownUntil = new Map<string, number>();

  constructor(private readonly selfName: string) {}

  getAttackWindow(): NukeAttackWindow | null {
    return this.attackWindow;
  }

  isAttackWindowOpen(nowMs: number): boolean {
    return (
      this.attackWindow !== null && nowMs < this.attackWindow.expiresAt
    );
  }

  resetFeint(): void {
    this.feintLaunched = false;
  }

  /**
   * Heuristic when no nuke-availability API exists:
   * - Owners of active (non-nuked) flags are assumed able to nuke.
   * - When observe() sees an enemy nuke a flag, that owner is excluded here
   *   for ENEMY_NUKE_WINDOW_MS (they are on cooldown — feint skipped, all-in steal).
   */
  inferEnemiesWithNuke(
    flags: FlagInfo[],
    flagOwners: Map<string, string | null>,
    nowMs: number,
  ): Set<string> {
    const result = new Set<string>();
    for (const f of flags) {
      if (f.nuked) {
        continue;
      }
      const owner = flagOwners.get(cellKey(f.x, f.y));
      if (!owner || owner === this.selfName || owner === "neutral") {
        continue;
      }
      const cooldownUntil = this.nukeCooldownUntil.get(owner);
      if (cooldownUntil !== undefined && nowMs < cooldownUntil) {
        continue;
      }
      result.add(owner);
    }
    return result;
  }

  /**
   * Ingest flags snapshot; returns a new attack window if an enemy just nuked.
   */
  observe(
    flags: FlagInfo[],
    flagOwners: Map<string, string | null>,
    nowMs: number,
  ): NukeAttackWindow | null {
    let opened: NukeAttackWindow | null = null;

    for (const f of flags) {
      const prev = this.previousFlags.get(f.flag_id);
      if (prev && !prev.nuked && f.nuked) {
        const owner = flagOwners.get(cellKey(f.x, f.y));
        if (owner && owner !== this.selfName) {
          this.nukeCooldownUntil.set(owner, nowMs + ENEMY_NUKE_WINDOW_MS);
          opened = {
            enemyName: owner,
            openedAt: nowMs,
            expiresAt: nowMs + ENEMY_NUKE_WINDOW_MS,
          };
          this.attackWindow = opened;
          this.feintLaunched = false;
        }
      }
      this.previousFlags.set(f.flag_id, { ...f });
    }

    // Expire stale cooldown entries.
    for (const [name, until] of this.nukeCooldownUntil) {
      if (nowMs >= until) {
        this.nukeCooldownUntil.delete(name);
      }
    }

    if (
      this.attackWindow &&
      nowMs >= this.attackWindow.expiresAt
    ) {
      this.attackWindow = null;
      this.feintLaunched = false;
    }

    return opened;
  }

  /**
   * Plan flag capture: feint first if window open and owner may still nuke;
   * then steal the valuable flag and nuke it ourselves.
   */
  planCapture(
    flags: FlagInfo[],
    flagOwners: Map<string, string | null>,
    owned: Set<string>,
    nowMs: number,
    enemiesWithNuke: Set<string>,
  ): { action: "claim"; target: Point; reason: string } | null {
    if (!this.isAttackWindowOpen(nowMs) || !this.attackWindow) {
      return null;
    }

    const juicyOwner = this.attackWindow.enemyName;
    const steal = selectStealTarget(
      flags,
      flagOwners,
      owned,
      this.selfName,
      juicyOwner,
    );
    if (!steal) {
      return null;
    }

    if (
      !this.feintLaunched &&
      enemiesWithNuke.has(juicyOwner)
    ) {
      const feint = selectFeintTarget(
        flags,
        flagOwners,
        owned,
        juicyOwner,
        this.selfName,
      );
      if (feint && (feint.pot < steal.pot || feint.flagId !== steal.flagId)) {
        if (isAdjacentToOwned(feint.x, feint.y, owned)) {
          this.feintLaunched = true;
          return {
            action: "claim",
            target: { x: feint.x, y: feint.y },
            reason: "feint",
          };
        }
      }
    }

    if (isAdjacentToOwned(steal.x, steal.y, owned)) {
      return {
        action: "claim",
        target: { x: steal.x, y: steal.y },
        reason: "steal",
      };
    }

    return null;
  }

  /** After capturing enemy flag tile, nuke it for celebration points. */
  planNuke(
    flags: FlagInfo[],
    flagOwners: Map<string, string | null>,
    owned: Set<string>,
  ): { flagId: string; x: number; y: number } | null {
    for (const f of flags) {
      if (f.nuked) {
        continue;
      }
      const k = cellKey(f.x, f.y);
      if (!owned.has(k)) {
        continue;
      }
      const owner = flagOwners.get(k);
      if (owner && owner !== this.selfName) {
        return { flagId: f.flag_id, x: f.x, y: f.y };
      }
    }
    return null;
  }
}
