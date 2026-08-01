import { MAX_PLAYERS } from "./engine/constants.js";
import { GameSession } from "./engine/game.js";

const games = new Map<string, GameSession>();

function parsePlayerIds(raw: string | undefined): void {
  if (!raw) {
    return;
  }
  const defaultGameId = process.env.GAME_ID ?? "default";
  const game = getOrCreateGame(defaultGameId);
  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }
    const [externalId, displayName, color] = trimmed.split(":");
    if (!externalId) {
      continue;
    }
    game.registerPlayer(
      externalId,
      displayName ?? externalId,
      color ?? "#888888",
    );
  }
}

export function createGame(id?: string): GameSession {
  const gameId = id ?? `game-${games.size + 1}`;
  const game = GameSession.createSeeded(gameId);
  games.set(gameId, game);
  return game;
}

export function resetGame(id: string): GameSession {
  const game = GameSession.createSeeded(id);
  games.set(id, game);
  return game;
}

export function getGame(id: string): GameSession | undefined {
  return games.get(id);
}

export function getOrCreateGame(id: string): GameSession {
  const existing = games.get(id);
  if (existing) {
    return existing;
  }
  const game = GameSession.createSeeded(id);
  games.set(id, game);
  return game;
}

export function listGames(): string[] {
  return [...games.keys()];
}

export function resolvePlayer(
  game: GameSession,
  externalId: string,
): { playerId: number } | { error: "unknown_player" | "game_full" } {
  const existing = game.findPlayerByExternalId(externalId);
  if (existing) {
    return { playerId: existing.id };
  }
  if (game.players.length >= MAX_PLAYERS) {
    return { error: "game_full" };
  }
  const displayName =
    externalId === (process.env.PLAYER_ID ?? "") &&
    process.env.SELF_DISPLAY_NAME?.trim()
      ? process.env.SELF_DISPLAY_NAME.trim()
      : externalId;
  const playerId = game.registerPlayer(
    externalId,
    displayName,
    nextDistinctColor(game),
  );
  if (playerId === null) {
    return { error: "game_full" };
  }
  return { playerId };
}

const PLAYER_PALETTE = [
  "#e6194b",
  "#3cb44b",
  "#4363d8",
  "#f58231",
  "#911eb4",
  "#42d4f4",
  "#f032e6",
  "#bfef45",
] as const;

/** Prefer an unused palette swatch so leaderboard colors stay distinct. */
function nextDistinctColor(game: GameSession): string {
  const used = new Set(
    game.players.map((p) => p.color.trim().toLowerCase()),
  );
  for (const swatch of PLAYER_PALETTE) {
    if (!used.has(swatch.toLowerCase())) {
      return swatch;
    }
  }
  // All 8 taken (shouldn't happen at MAX_PLAYERS=8) — fall back to hex hue spread.
  const hue = (game.players.length * 47) % 360;
  return hueToHex(hue);
}

function hueToHex(hue: number): string {
  const s = 0.72;
  const l = 0.5;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) {
    r = c;
    g = x;
  } else if (hue < 120) {
    r = x;
    g = c;
  } else if (hue < 180) {
    g = c;
    b = x;
  } else if (hue < 240) {
    g = x;
    b = c;
  } else if (hue < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const toByte = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toByte(r)}${toByte(g)}${toByte(b)}`;
}

export function bootstrapFromEnv(): GameSession {
  const gameId = process.env.GAME_ID ?? "default";
  const game = getOrCreateGame(gameId);
  parsePlayerIds(process.env.PLAYER_IDS);
  return game;
}

export function clearRegistryForTests(): void {
  games.clear();
}
