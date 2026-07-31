import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { registerHarnessRoutes } from "../harness/adminRoutes.js";
import { registerRoutes } from "./routes.js";
import { registerSpectatorRoutes } from "./spectatorRoutes.js";

export interface AppOptions {
  logger?: boolean;
}

const SENSITIVE_LOG_REDACT_PATHS = [
  "req.headers.authorization",
  'req.headers["x-harness-token"]',
  "req.headers.cookie",
] as const;

function buildLoggerOption(enabled: boolean): FastifyServerOptions["logger"] {
  if (!enabled) {
    return false;
  }
  return {
    level: "info",
    redact: {
      paths: [...SENSITIVE_LOG_REDACT_PATHS],
      censor: "[Redacted]",
    },
  };
}

export async function createApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: buildLoggerOption(options.logger ?? false) });

  app.addHook("onRequest", async (_request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    reply.header(
      "Access-Control-Allow-Headers",
      "Content-Type, X-Player-Id, X-Harness-Token, X-Source",
    );
  });

  app.options("*", async (_request, reply) => {
    reply.status(204).send();
  });

  await registerRoutes(app);
  await registerSpectatorRoutes(app);
  await registerHarnessRoutes(app);
  return app;
}
