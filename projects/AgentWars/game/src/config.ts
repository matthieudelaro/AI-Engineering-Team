import { config as loadEnv } from "dotenv";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");

loadEnv({ path: resolve(repoRoot, ".env") });

const envSchema = z.object({
  PLAYER_ID: z.string().min(1).default("remotematthieu999"),
  GAME_ID: z.string().min(1).default("live1"),
  GAME_API_URL: z.string().url(),
  GAME_API_TOKEN: z.string().default("your-token-here"),
  GAME_API_AUTH_HEADER: z.string().default("Authorization"),
  AUTH_MODE: z.enum(["event", "token"]).default("event"),
  GATEWAY_PORT: z.coerce.number().int().positive().default(3100),
  GATEWAY_HOST: z.string().default("127.0.0.1"),
  DATABASE_URL: z.string().min(1),
  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  POLL_MAX_RPS: z.coerce.number().positive().default(2),
  GATEWAY_MAX_BODY_BYTES: z.coerce.number().int().positive().default(65536),
  POLICY_TICK_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  UI_CLAIM_PRIORITY_MS: z.coerce.number().int().positive().default(1000),
  DRY_RUN: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnvConfig(): Env {
  return envSchema.parse(process.env);
}

const zoneSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
});

const stateEndpointSchema = z.object({
  key: z.string().min(1),
  method: z.enum(["GET", "POST"]),
  path: z.string().min(1),
  streamPath: z.string().min(1).optional(),
  pollIntervalMs: z.number().int().positive().optional(),
  maxPerSec: z.number().positive().optional(),
  limitKey: z.string().min(1).optional(),
});

const apiEndpointsSchema = z.object({
  upstreamBaseUrl: z.string(),
  authHeader: z.string(),
  stateEndpoints: z.array(stateEndpointSchema),
});

const abTestSchema = z.object({
  board: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  policies: z.array(
    z.object({
      key: z.string().min(1),
      zone: zoneSchema,
    }),
  ),
});

export type Zone = z.infer<typeof zoneSchema>;
export type StateEndpoint = z.infer<typeof stateEndpointSchema>;
export type ApiEndpointsConfig = z.infer<typeof apiEndpointsSchema>;
export type AbTestConfig = z.infer<typeof abTestSchema>;

function interpolateEnv(value: string, env: Env): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, key: string) => {
    const record = env as Record<string, string | number | boolean>;
    const resolved = record[key];
    if (resolved === undefined) {
      throw new Error(`Missing env var for config interpolation: ${key}`);
    }
    return String(resolved);
  });
}

function readJsonConfig<T>(relativePath: string, schema: z.ZodSchema<T>): T {
  const path = resolve(__dirname, "..", relativePath);
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return schema.parse(raw);
}

export function loadApiEndpointsConfig(env: Env): ApiEndpointsConfig {
  const config = readJsonConfig("config/api.endpoints.json", apiEndpointsSchema);
  return {
    ...config,
    upstreamBaseUrl: interpolateEnv(config.upstreamBaseUrl, env),
    authHeader: interpolateEnv(config.authHeader, env),
    stateEndpoints: config.stateEndpoints.map((endpoint) => ({
      ...endpoint,
      path: interpolateEnv(endpoint.path, env),
      streamPath: endpoint.streamPath
        ? interpolateEnv(endpoint.streamPath, env)
        : undefined,
    })),
  };
}

export function loadAbTestConfig(): AbTestConfig {
  return readJsonConfig("config/ab-test.json", abTestSchema);
}

export function getGatewayBaseUrl(env: Env): string {
  return `http://${env.GATEWAY_HOST}:${env.GATEWAY_PORT}`;
}

export function getPoliciesDir(): string {
  return resolve(repoRoot, "policies");
}

export function getRepoRoot(): string {
  return repoRoot;
}
