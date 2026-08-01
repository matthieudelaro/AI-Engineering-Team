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
  const playerId = game.registerPlayer(externalId, externalId, randomColor());
  if (playerId === null) {
    return { error: "game_full" };
  }
  return { playerId };
}

function randomColor(): string {
  const palette = [
    "#e6194b",
    "#3cb44b",
    "#4363d8",
    "#f58231",
    "#911eb4",
    "#46f0f0",
    "#f032e6",
    "#bcf60c",
  ];
  return palette[Math.floor(Math.random() * palette.length)] ?? "#888888";
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
