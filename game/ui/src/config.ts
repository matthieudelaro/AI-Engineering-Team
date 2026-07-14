import gameConfig from "../../config/game.json";

export const GAME_ID = gameConfig.gameId;
export const PLAYER_ID = gameConfig.playerId;

/** Gateway base URL when UI is hosted separately from the proxy (e.g. VITE_GATEWAY_URL=http://127.0.0.1:3100). */
export const GATEWAY_BASE_URL = (
  import.meta.env.VITE_GATEWAY_URL as string | undefined
)?.replace(/\/$/, "") ?? "";
