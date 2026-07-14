import {
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

export const apiCalls = pgTable("api_calls", {
  id: serial("id").primaryKey(),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  method: varchar("method", { length: 16 }).notNull(),
  path: text("path").notNull(),
  query: text("query"),
  requestHeadersRedacted: jsonb("request_headers_redacted"),
  requestBody: text("request_body"),
  responseStatus: integer("response_status"),
  responseBody: text("response_body"),
  latencyMs: integer("latency_ms"),
  policyId: varchar("policy_id", { length: 64 }),
  runId: integer("run_id"),
  error: text("error"),
  source: varchar("source", { length: 32 }).default("gateway"),
});

export const gameStates = pgTable("game_states", {
  id: serial("id").primaryKey(),
  endpointKey: varchar("endpoint_key", { length: 64 }).notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  payloadJson: jsonb("payload_json"),
  etagOrHash: varchar("etag_or_hash", { length: 128 }),
});

export const policyRuns = pgTable("policy_runs", {
  id: serial("id").primaryKey(),
  policyKey: varchar("policy_key", { length: 64 }).notNull(),
  zoneJson: jsonb("zone_json"),
  status: varchar("status", { length: 32 }).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  stoppedAt: timestamp("stopped_at", { withTimezone: true }),
  configJson: jsonb("config_json"),
  pid: integer("pid"),
});

export const policyEvents = pgTable("policy_events", {
  id: serial("id").primaryKey(),
  runId: integer("run_id"),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  level: varchar("level", { length: 16 }).notNull(),
  eventType: varchar("event_type", { length: 64 }).notNull(),
  message: text("message").notNull(),
  dataJson: jsonb("data_json"),
  source: varchar("source", { length: 32 }).default("policy"),
});
