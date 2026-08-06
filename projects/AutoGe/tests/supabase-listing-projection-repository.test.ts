import { describe, expect, it, vi } from "vitest";

import type { AutoGeListingObservation } from "../src/autoge/listing-parser.js";
import {
  SupabaseListingProjectionRepository,
  toListingProjectionRow,
  type ListingProjectionUpsertGateway,
} from "../src/storage/supabase-listing-projection-repository.js";

const observation: AutoGeListingObservation = {
  listingId: "1000001",
  url: "https://www.auto.ge/en/auto/test/multi-phone-1000001.html",
  make: "Test",
  model: "Multi phone",
  phoneCollectionStatus: "observed",
  sellerPhoneNumbers: [
    {
      displayText: "555 000 001",
      digits: "555000001",
      e164: "+995555000001",
    },
    { displayText: "928", digits: "928" },
  ],
};

const projectionInput = {
  observation,
  observedAt: "2026-08-06T10:00:00.000Z",
  sourceEventId: "01990d8e-0c5e-7b0f-b811-15f90b39e5f6",
  projectionVersion: 1,
} as const;

describe("Supabase listing projection persistence", () => {
  it("maps phone collection metadata into the queryable projection", () => {
    expect(toListingProjectionRow(projectionInput)).toMatchObject({
      listing_id: "1000001",
      phone_collection_status: "observed",
      seller_phone_numbers: [
        {
          displayText: "555 000 001",
          digits: "555000001",
          e164: "+995555000001",
        },
        { displayText: "928", digits: "928" },
      ],
    });
  });

  it("writes explicit empty phone defaults when collection was not attempted", () => {
    expect(
      toListingProjectionRow({
        ...projectionInput,
        observation: {
          ...observation,
          phoneCollectionStatus: "not_checked",
          sellerPhoneNumbers: [],
        },
      }),
    ).toMatchObject({
      phone_collection_status: "not_checked",
      seller_phone_numbers: [],
    });
  });

  it("surfaces projection upsert failures", async () => {
    const upsert = vi.fn().mockResolvedValue({ message: "write failed" });
    const gateway: ListingProjectionUpsertGateway = { upsert };
    const repository = new SupabaseListingProjectionRepository(gateway);

    await expect(repository.upsert(projectionInput)).rejects.toThrow(
      "write failed",
    );
  });
});
