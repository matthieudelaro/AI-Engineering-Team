import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { DomainEvent } from "../src/domain/event.js";
import { SQLiteEventRepository } from "../src/storage/sqlite-event-repository.js";

const event: DomainEvent = {
  eventId: "b5d0cd36-0db3-42e5-8e8e-f84d06de980d",
  eventType: "listing_discovered",
  occurredAt: "2026-08-06T10:00:00.000Z",
  recordedAt: "2026-08-06T10:00:01.000Z",
  subjectType: "listing",
  subjectId: "auto.ge:1564891",
  source: "auto.ge",
  payload: { listingId: "1564891" },
  schemaVersion: 1,
};

describe("SQLiteEventRepository", () => {
  it("persists events idempotently in an append-only database", async () => {
    const directory = await mkdtemp(join(tmpdir(), "autoge-sqlite-"));
    const repository = new SQLiteEventRepository(
      join(directory, "events.sqlite"),
    );

    repository.initialize();
    repository.append(event);
    repository.append(event);

    expect(repository.count()).toBe(1);
    expect(repository.readAll()).toEqual([event]);
    expect(() => {
      repository.executeUnsafeForTest("delete from autoge_events");
    }).toThrow("autoge_events is append-only");
    repository.close();
  });
});
