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

/**
 * Build map colors from leaderboard entries. Uses each player's API color when
 * unique; when several players share the same API color, keeps the largest
 * territory on the API color and shifts hue for the others.
 */
export function buildPlayerColors(entries: LeaderboardEntry[]): PlayerColors {
  const byName = new Map<string, string>();
  const groups = new Map<string, LeaderboardEntry[]>();

  for (const entry of entries) {
    if (entry.is_self) {
      continue;
    }
    const group = groups.get(entry.color) ?? [];
    group.push(entry);
    groups.set(entry.color, group);
  }

  for (const [apiColor, group] of groups) {
    if (group.length === 1) {
      byName.set(group[0]!.display_name, apiColor);
      continue;
    }

    const sorted = [...group].sort((a, b) => b.tile_count - a.tile_count);
    for (let i = 0; i < sorted.length; i++) {
      const entry = sorted[i]!;
      if (i === 0) {
        byName.set(entry.display_name, apiColor);
      } else {
        const spread = 360 / sorted.length;
        byName.set(entry.display_name, shiftHue(apiColor, spread * i));
      }
    }
  }

  const self = entries.find((entry) => entry.is_self);
  if (self) {
    byName.set(self.display_name, SELF_MAP_COLOR);
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
