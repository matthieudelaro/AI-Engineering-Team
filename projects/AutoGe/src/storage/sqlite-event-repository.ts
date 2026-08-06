import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";

import { z } from "zod";

import { domainEventSchema, type DomainEvent } from "../domain/event.js";

const eventRowSchema = z.object({
  event_id: z.string(),
  event_type: z.string(),
  occurred_at: z.string(),
  recorded_at: z.string(),
  subject_type: z.string(),
  subject_id: z.string(),
  causation_id: z.string().nullable(),
  correlation_id: z.string().nullable(),
  source: z.string(),
  payload_json: z.string(),
  raw_artifact_id: z.string().nullable(),
  schema_version: z.number(),
});

const SQLITE_SCHEMA = `
pragma journal_mode = wal;
pragma foreign_keys = on;

create table if not exists autoge_events (
  event_id text primary key,
  event_type text not null,
  occurred_at text not null,
  recorded_at text not null,
  subject_type text not null,
  subject_id text not null,
  causation_id text references autoge_events (event_id),
  correlation_id text,
  source text not null,
  payload_json text not null check (json_valid(payload_json)),
  raw_artifact_id text,
  schema_version integer not null check (schema_version > 0),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create index if not exists autoge_events_subject_idx
on autoge_events (subject_type, subject_id, occurred_at, event_id);

create trigger if not exists autoge_events_reject_update
before update on autoge_events
begin
  select raise(abort, 'autoge_events is append-only');
end;

create trigger if not exists autoge_events_reject_delete
before delete on autoge_events
begin
  select raise(abort, 'autoge_events is append-only');
end;
`;

export class SQLiteEventRepository {
  private readonly database: DatabaseSync;

  public constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
  }

  public initialize(): void {
    this.database.exec(SQLITE_SCHEMA);
  }

  public append(untrustedEvent: DomainEvent): void {
    const event = domainEventSchema.parse(untrustedEvent);
    this.database
      .prepare(
        `insert or ignore into autoge_events (
          event_id, event_type, occurred_at, recorded_at, subject_type,
          subject_id, causation_id, correlation_id, source, payload_json,
          raw_artifact_id, schema_version
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.eventId,
        event.eventType,
        event.occurredAt,
        event.recordedAt,
        event.subjectType,
        event.subjectId,
        event.causationId ?? null,
        event.correlationId ?? null,
        event.source,
        JSON.stringify(event.payload),
        event.rawArtifactId ?? null,
        event.schemaVersion,
      );
  }

  public count(): number {
    const row = this.database
      .prepare("select count(*) as count from autoge_events")
      .get();
    return z.object({ count: z.number() }).parse(row).count;
  }

  public readAll(): DomainEvent[] {
    const rows = this.database
      .prepare("select * from autoge_events order by recorded_at, event_id")
      .all();

    return rows.map((untrustedRow) => {
      const row = eventRowSchema.parse(untrustedRow);
      return domainEventSchema.parse({
        eventId: row.event_id,
        eventType: row.event_type,
        occurredAt: row.occurred_at,
        recordedAt: row.recorded_at,
        subjectType: row.subject_type,
        subjectId: row.subject_id,
        ...(row.causation_id === null ? {} : { causationId: row.causation_id }),
        ...(row.correlation_id === null
          ? {}
          : { correlationId: row.correlation_id }),
        source: row.source,
        payload: JSON.parse(row.payload_json) as unknown,
        ...(row.raw_artifact_id === null
          ? {}
          : { rawArtifactId: row.raw_artifact_id }),
        schemaVersion: row.schema_version,
      });
    });
  }

  public executeUnsafeForTest(sql: string): void {
    this.database.exec(sql);
  }

  public close(): void {
    this.database.close();
  }
}
