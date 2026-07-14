import type { Zone } from "../config.js";
import type { GameClient } from "../client/gameClient.js";
import type { Database } from "../db/index.js";

export interface Cell {
  x: number;
  y: number;
}

export interface PolicyContext {
  policyKey: string;
  runId: number;
  gameId: string;
  zone: Zone | undefined;
  dryRun: boolean;
  client: GameClient;
  db: Database;
  logEvent: (
    level: "info" | "warn" | "error",
    eventType: string,
    message: string,
    data?: Record<string, unknown>,
  ) => Promise<void>;
  getLatestState: (endpointKey: string) => Promise<unknown | null>;
}

export interface Policy {
  key: string;
  zone?: Zone;
  onStart?: (ctx: PolicyContext) => Promise<void>;
  tick: (ctx: PolicyContext) => Promise<void>;
  onStop?: (ctx: PolicyContext) => Promise<void>;
}

export interface PolicyRunOptions {
  policyKey: string;
  zone?: Zone;
  dryRun?: boolean;
  maxTicks?: number;
}
