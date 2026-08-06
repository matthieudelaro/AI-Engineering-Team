import { describe, expect, it } from "vitest";

import type { DomainEvent } from "../src/domain/event.js";
import {
  assertAnalyzedOffersAreRegistered,
  buildOfferRegistry,
  extractAnalyzedListingIds,
  renderOfferRegistry,
  type SourcedEvent,
} from "../src/domain/offer-registry.js";

function event(
  overrides: Partial<DomainEvent> & Pick<DomainEvent, "eventId" | "eventType">,
): DomainEvent {
  return {
    eventId: overrides.eventId,
    eventType: overrides.eventType,
    occurredAt: overrides.occurredAt ?? "2026-08-06T10:00:00.000Z",
    recordedAt: overrides.recordedAt ?? "2026-08-06T10:00:01.000Z",
    subjectType: overrides.subjectType ?? "listing",
    subjectId: overrides.subjectId ?? "auto.ge:1075336",
    source: overrides.source ?? "auto.ge",
    payload: overrides.payload ?? {},
    schemaVersion: overrides.schemaVersion ?? 1,
  };
}

function sourced(
  domainEvent: DomainEvent,
  batch = "events.json",
): SourcedEvent {
  return { event: domainEvent, batch };
}

describe("offer registry projection", () => {
  it("consolidates listing, disposition, and corrected contact evidence", () => {
    const events: SourcedEvent[] = [
      sourced(
        event({
          eventId: "00000000-0000-4000-8000-000000000001",
          eventType: "listing_discovered",
          payload: {
            listingId: "1075336",
            url: "https://www.auto.ge/en/auto/ford/transit/ford-transit-1075336.html",
          },
        }),
      ),
      sourced(
        event({
          eventId: "00000000-0000-4000-8000-000000000002",
          eventType: "action_failed",
          payload: {
            action: "seller_message_send",
            status: "delivery_unknown",
          },
        }),
        "contact-attempts.json",
      ),
      sourced(
        event({
          eventId: "00000000-0000-4000-8000-000000000003",
          eventType: "message_history_observed",
          payload: {
            conversationId: "30052",
            deliveryConfirmed: true,
            duplicateCount: 1,
          },
        }),
        "message-history.json",
      ),
      sourced(
        event({
          eventId: "00000000-0000-4000-8000-000000000004",
          eventType: "listing_disposition_recorded",
          source: "autoge_car_finder",
          payload: {
            listingId: "1075336",
            disposition: "rejected",
            reason: "Vehicle advertised abroad",
          },
        }),
        "decisions.json",
      ),
    ];

    expect(buildOfferRegistry(events)).toEqual([
      {
        listingId: "1075336",
        url: "https://www.auto.ge/en/auto/ford/transit/ford-transit-1075336.html",
        disposition: "rejected",
        dispositionReason: "Vehicle advertised abroad",
        contactStatus: "confirmed_with_duplicate",
        conversationId: "30052",
        sourceEvidence: [
          "contact-attempts.json:action_failed:auto.ge",
          "decisions.json:listing_disposition_recorded:autoge_car_finder",
          "events.json:listing_discovered:auto.ge",
          "message-history.json:message_history_observed:auto.ge",
        ],
      },
    ]);
  });

  it("links conversation events to an offer through payload.listingId", () => {
    const entries = buildOfferRegistry([
      sourced(
        event({
          eventId: "00000000-0000-4000-8000-000000000005",
          eventType: "seller_message_sent",
          subjectType: "conversation",
          subjectId: "auto.ge:conversation:51603",
          source: "auto.ge_message_history",
          payload: { listingId: "1612875", deliveryConfirmed: true },
        }),
      ),
    ]);

    expect(entries[0]).toMatchObject({
      listingId: "1612875",
      contactStatus: "confirmed",
      conversationId: "51603",
    });
  });

  it("finds report listings and rejects narrative-only offers", () => {
    const report = `
      [Transit](https://www.auto.ge/en/auto/ford/transit/ford-transit-1075336.html)
      [Quest](https://www.auto.ge/en/auto/nissan/quest/nissan-quest-1047716.html)
    `;

    expect(extractAnalyzedListingIds(report)).toEqual(["1047716", "1075336"]);
    expect(() => {
      assertAnalyzedOffersAreRegistered(
        [{ path: "SHORTLIST.md", markdown: report }],
        ["1047716"],
      );
    }).toThrow("SHORTLIST.md: 1075336");
  });

  it("renders a deterministic English audit table without raw contact data", () => {
    const markdown = renderOfferRegistry(
      [
        {
          listingId: "1075336",
          url: "https://www.auto.ge/en/auto/ford/transit/ford-transit-1075336.html",
          disposition: "rejected",
          dispositionReason: "Vehicle advertised abroad",
          contactStatus: "not_contacted",
          sourceEvidence: ["events.json:listing_discovered:auto.ge"],
        },
      ],
      "2026-08-06T15:01:37.000Z",
      ["events.json"],
    );

    expect(markdown).toContain("Canonical AutoGe offer registry");
    expect(markdown).toContain("| 1075336 |");
    expect(markdown).toContain("Vehicle advertised abroad");
    expect(markdown).not.toMatch(/\+995|phone/i);
  });
});
