import { describe, expect, it } from "vitest";

import { domainEventSchema } from "../src/domain/event.js";

describe("domainEventSchema", () => {
  it("accepts a versioned immutable observation", () => {
    const event = domainEventSchema.parse({
      eventId: "01990d8e-0c5e-7b0f-b811-15f90b39e5f6",
      eventType: "listing_snapshot_captured",
      occurredAt: "2026-08-06T10:00:00.000Z",
      recordedAt: "2026-08-06T10:00:01.000Z",
      subjectType: "listing",
      subjectId: "auto.ge:1564891",
      source: "auto.ge",
      schemaVersion: 1,
      payload: { listingId: "1564891" },
    });

    expect(event.source).toBe("auto.ge");
  });

  it("rejects events without stable identifiers", () => {
    expect(() =>
      domainEventSchema.parse({
        eventType: "listing_discovered",
        payload: {},
      }),
    ).toThrow();
  });

  it("requires phone collection fields in listing discovery payload version 2", () => {
    const versionTwoDiscovery = {
      eventId: "01990d8e-0c5e-7b0f-b811-15f90b39e5f6",
      eventType: "listing_discovered",
      occurredAt: "2026-08-06T10:00:00.000Z",
      recordedAt: "2026-08-06T10:00:01.000Z",
      subjectType: "listing",
      subjectId: "auto.ge:1000001",
      source: "auto.ge",
      schemaVersion: 2,
      payload: { listingId: "1000001" },
    };

    expect(() => domainEventSchema.parse(versionTwoDiscovery)).toThrow();
    expect(() =>
      domainEventSchema.parse({
        ...versionTwoDiscovery,
        payload: {
          ...versionTwoDiscovery.payload,
          phoneCollectionStatus: "not_checked",
          sellerPhoneNumbers: [],
        },
      }),
    ).not.toThrow();
  });
});
