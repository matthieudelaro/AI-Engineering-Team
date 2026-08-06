import { describe, expect, it, vi } from "vitest";

import type { DomainEvent } from "../src/domain/event.js";
import {
  SupabaseEventRepository,
  loadSupabaseConfig,
  toEventRow,
  type EventInsertGateway,
} from "../src/storage/supabase-event-repository.js";

const event: DomainEvent = {
  eventId: "01990d8e-0c5e-7b0f-b811-15f90b39e5f6",
  eventType: "listing_discovered",
  occurredAt: "2026-08-06T10:00:00.000Z",
  recordedAt: "2026-08-06T10:00:01.000Z",
  subjectType: "listing",
  subjectId: "auto.ge:1564891",
  source: "auto.ge",
  payload: { listingId: "1564891" },
  schemaVersion: 1,
};

describe("Supabase event persistence", () => {
  it("maps domain events to the database naming convention", () => {
    expect(toEventRow(event)).toMatchObject({
      event_id: event.eventId,
      event_type: event.eventType,
      subject_id: event.subjectId,
      schema_version: 1,
    });
  });

  it("surfaces database failures", async () => {
    const insert = vi
      .fn()
      .mockResolvedValue({ message: "database unavailable" });
    const gateway: EventInsertGateway = { insert };
    const repository = new SupabaseEventRepository(gateway);

    await expect(repository.append(event)).rejects.toThrow(
      "database unavailable",
    );
  });

  it("requires server-side Supabase configuration", () => {
    expect(() => loadSupabaseConfig({})).toThrow("AUTOGE_SUPABASE_URL");
    expect(() =>
      loadSupabaseConfig({
        AUTOGE_SUPABASE_URL: "https://example.supabase.co",
        AUTOGE_SUPABASE_SECRET_KEY: "secret",
      }),
    ).not.toThrow();
  });
});
