import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { domainEventSchema, type DomainEvent } from "../domain/event.js";

export interface EventRow {
  readonly event_id: string;
  readonly event_type: string;
  readonly occurred_at: string;
  readonly recorded_at: string;
  readonly subject_type: string;
  readonly subject_id: string;
  readonly causation_id?: string;
  readonly correlation_id?: string;
  readonly source: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly raw_artifact_id?: string;
  readonly schema_version: number;
}

export interface InsertFailure {
  readonly message: string;
}

export interface EventInsertGateway {
  insert(row: EventRow): Promise<InsertFailure | null>;
}

const supabaseConfigSchema = z.object({
  AUTOGE_SUPABASE_URL: z.url(),
  AUTOGE_SUPABASE_SECRET_KEY: z.string().min(1),
});

export type SupabaseConfig = z.infer<typeof supabaseConfigSchema>;

export class SupabaseEventRepository {
  public constructor(private readonly gateway: EventInsertGateway) {}

  public async append(untrustedEvent: DomainEvent): Promise<void> {
    const event = domainEventSchema.parse(untrustedEvent);
    const failure = await this.gateway.insert(toEventRow(event));
    if (failure !== null) {
      throw new Error(`Failed to append AutoGe event: ${failure.message}`);
    }
  }
}

export function loadSupabaseConfig(
  environment: Readonly<Record<string, string | undefined>>,
): SupabaseConfig {
  return supabaseConfigSchema.parse(environment);
}

export function createSupabaseEventRepository(
  config: SupabaseConfig,
): SupabaseEventRepository {
  const client = createClient(
    config.AUTOGE_SUPABASE_URL,
    config.AUTOGE_SUPABASE_SECRET_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );

  const gateway: EventInsertGateway = {
    async insert(row): Promise<InsertFailure | null> {
      const { error } = await client.from("autoge_events").insert(row);
      return error === null ? null : { message: error.message };
    },
  };

  return new SupabaseEventRepository(gateway);
}

export function toEventRow(event: DomainEvent): EventRow {
  return {
    event_id: event.eventId,
    event_type: event.eventType,
    occurred_at: event.occurredAt,
    recorded_at: event.recordedAt,
    subject_type: event.subjectType,
    subject_id: event.subjectId,
    ...(event.causationId === undefined
      ? {}
      : { causation_id: event.causationId }),
    ...(event.correlationId === undefined
      ? {}
      : { correlation_id: event.correlationId }),
    source: event.source,
    payload: event.payload,
    ...(event.rawArtifactId === undefined
      ? {}
      : { raw_artifact_id: event.rawArtifactId }),
    schema_version: event.schemaVersion,
  };
}
