import type { FastifyReply } from "fastify";
import type { RejectionReason } from "../engine/constants.js";
import { buildRejectedResponse } from "../engine/game.js";
import {
  checkRateLimit,
  rateLimitHeaders,
  type RateLimitEndpoint,
  type RateLimitResult,
} from "./rateLimit.js";

export function applyRateLimitHeaders(
  reply: FastifyReply,
  result: RateLimitResult,
): void {
  const headers = rateLimitHeaders(result);
  for (const [key, value] of Object.entries(headers)) {
    reply.header(key, value);
  }
}

export function enforceRateLimit(
  reply: FastifyReply,
  playerId: string,
  endpoint: RateLimitEndpoint,
): RateLimitResult | null {
  const result = checkRateLimit(playerId, endpoint);
  applyRateLimitHeaders(reply, result);
  if (!result.allowed) {
    reply.status(429).send(buildRejectedResponse("RATE_LIMITED", result.retryAfter));
    return null;
  }
  return result;
}

export function rejectionStatus(reason: RejectionReason): number {
  switch (reason) {
    case "OUT_OF_BOUNDS":
      return 400;
    case "INVALID_TARGET":
      return 409;
    default:
      return 400;
  }
}

export function sendRejection(
  reply: FastifyReply,
  reason: RejectionReason,
): void {
  reply.status(rejectionStatus(reason)).send(buildRejectedResponse(reason, 0));
}

export function notImplemented(reply: FastifyReply, details: string): void {
  reply.status(501).send({ error: "not_implemented", details });
}

export function requirePlayerId(
  reply: FastifyReply,
  playerId: string | undefined,
): playerId is string {
  if (!playerId) {
    reply.status(401).send({
      error: "unauthorized",
      details: "X-Player-Id header is required",
    });
    return false;
  }
  return true;
}
