import type { LeaderboardEntry, PlayerColors } from "./types.js";

/** Fixed map color for the current player — always distinct from API palette. */
export const SELF_MAP_COLOR = "#ff2d95";

function parseHex(hex: string): [number, number, number] | null {
  const normalized = hex.replace("#", "");
  if (normalized.length !== 6) {
    return null;
  }
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return null;
  }
  return [r, g, b];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

  if (delta !== 0) {
    if (max === rn) {
      h = ((gn - bn) / delta) % 6;
    } else if (max === gn) {
      h = (bn - rn) / delta + 2;
    } else {
      h = (rn - gn) / delta + 4;
    }
    h *= 60;
    if (h < 0) {
      h += 360;
    }
  }

  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rn = 0;
  let gn = 0;
  let bn = 0;

  if (h < 60) {
    rn = c;
    gn = x;
  } else if (h < 120) {
    rn = x;
    gn = c;
  } else if (h < 180) {
    gn = c;
    bn = x;
  } else if (h < 240) {
    gn = x;
    bn = c;
  } else if (h < 300) {
    rn = x;
    bn = c;
  } else {
    rn = c;
    bn = x;
  }

  const toByte = (value: number) =>
    Math.round((value + m) * 255)
      .toString(16)
      .padStart(2, "0");

  return `#${toByte(rn)}${toByte(gn)}${toByte(bn)}`;
}

function shiftHue(hex: string, degrees: number): string {
  const rgb = parseHex(hex);
  if (!rgb) {
    return hex;
  }
  const [h, s, l] = rgbToHsl(...rgb);
  return hslToHex((h + degrees + 360) % 360, Math.min(1, s * 1.05), l);
}

/** Deterministic fallback when a tile owner is missing from the leaderboard. */
export function hashColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return hslToHex(hue, 0.65, 0.52);
}

function normalizeColorKey(hex: string): string {
  return hex.trim().toLowerCase();
}

function colorIsTaken(hex: string, used: ReadonlySet<string>): boolean {
  return used.has(normalizeColorKey(hex));
}

function markUsed(hex: string, used: Set<string>): void {
  used.add(normalizeColorKey(hex));
}

/** Pick API color if free; otherwise hue-shift, then hash as last resort. */
function assignFreeColor(
  preferred: string,
  displayName: string,
  used: Set<string>,
  collisionIndex: number,
  collisionCount: number,
): string {
  const tryCandidate = (candidate: string): string | null => {
    if (colorIsTaken(candidate, used) || normalizeColorKey(candidate) === normalizeColorKey(SELF_MAP_COLOR)) {
      return null;
    }
    return candidate;
  };

  if (collisionIndex === 0) {
    const direct = tryCandidate(preferred);
    if (direct) {
      return direct;
    }
  } else {
    const spread = 360 / Math.max(collisionCount, 1);
    const shifted = tryCandidate(shiftHue(preferred, spread * collisionIndex));
    if (shifted) {
      return shifted;
    }
  }

  for (let step = 1; step <= 11; step++) {
    const candidate = tryCandidate(shiftHue(preferred, 30 * step));
    if (candidate) {
      return candidate;
    }
  }

  const hashed = hashColor(displayName);
  const hashedFree = tryCandidate(hashed);
  if (hashedFree) {
    return hashedFree;
  }

  // Extremely crowded palette — keep shifting the hash until unique.
  for (let step = 1; step <= 35; step++) {
    const candidate = tryCandidate(shiftHue(hashed, 10 * step));
    if (candidate) {
      return candidate;
    }
  }
  return hashed;
}

/**
 * Build map colors from leaderboard entries.
 *
 * - Self is always {@link SELF_MAP_COLOR}.
 * - Other players keep sticky colors from a previous build when provided.
 * - New players prefer their API color when free; API-color collisions among
 *   newcomers are broken by sorted `display_name` (never score/tile_count).
 */
export function buildPlayerColors(
  entries: LeaderboardEntry[],
  previous: PlayerColors | null = null,
): PlayerColors {
  const byName = new Map<string, string>();
  const used = new Set<string>();
  markUsed(SELF_MAP_COLOR, used);

  const self = entries.find((entry) => entry.is_self);
  if (self) {
    byName.set(self.display_name, SELF_MAP_COLOR);
  }

  const others = entries.filter((entry) => !entry.is_self);

  // Sticky: keep prior identity→color so rank/API palette churn cannot swap hues.
  if (previous) {
    for (const entry of others) {
      const sticky = previous.byName.get(entry.display_name);
      if (!sticky || sticky === SELF_MAP_COLOR) {
        continue;
      }
      byName.set(entry.display_name, sticky);
      markUsed(sticky, used);
    }
  }

  const newcomers = others.filter((entry) => !byName.has(entry.display_name));
  const groups = new Map<string, LeaderboardEntry[]>();
  for (const entry of newcomers) {
    const group = groups.get(entry.color) ?? [];
    group.push(entry);
    groups.set(entry.color, group);
  }

  for (const [apiColor, group] of groups) {
    const sorted = [...group].sort((a, b) =>
      a.display_name.localeCompare(b.display_name),
    );
    for (let i = 0; i < sorted.length; i++) {
      const entry = sorted[i]!;
      const color = assignFreeColor(
        apiColor,
        entry.display_name,
        used,
        i,
        sorted.length,
      );
      byName.set(entry.display_name, color);
      markUsed(color, used);
    }
  }

  return {
    selfName: self?.display_name ?? null,
    selfColor: SELF_MAP_COLOR,
    byName,
  };
}

export function mapColorForPlayer(
  name: string,
  colors: PlayerColors,
): string {
  if (name === colors.selfName) {
    return colors.selfColor;
  }
  return colors.byName.get(name) ?? hashColor(name);
}
