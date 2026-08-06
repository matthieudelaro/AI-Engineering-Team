import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  autoGeListingObservationSchema,
  type PhoneCollectionStatus,
  type SellerPhoneNumber,
} from "../autoge/listing-parser.js";
import type { SupabaseConfig } from "./supabase-event-repository.js";

const listingProjectionInputSchema = z.object({
  observation: autoGeListingObservationSchema,
  observedAt: z.iso.datetime(),
  sourceEventId: z.uuid(),
  projectionVersion: z.int().positive(),
});

export type ListingProjectionInput = z.input<
  typeof listingProjectionInputSchema
>;

export interface ListingProjectionRow {
  readonly listing_id: string;
  readonly canonical_url: string;
  readonly title: string;
  readonly make: string;
  readonly model: string;
  readonly year: number | null;
  readonly mileage: number | null;
  readonly mileage_unit: "km" | "miles" | null;
  readonly price_amount: number | null;
  readonly price_currency: "GEL" | "USD" | null;
  readonly customs_status: string | null;
  readonly drivetrain: string | null;
  readonly location: string | null;
  readonly phone_collection_status: PhoneCollectionStatus;
  readonly seller_phone_numbers: readonly SellerPhoneNumber[];
  readonly observed_at: string;
  readonly source_event_id: string;
  readonly projection_version: number;
}

export interface ProjectionUpsertFailure {
  readonly message: string;
}

export interface ListingProjectionUpsertGateway {
  upsert(row: ListingProjectionRow): Promise<ProjectionUpsertFailure | null>;
}

export class SupabaseListingProjectionRepository {
  public constructor(
    private readonly gateway: ListingProjectionUpsertGateway,
  ) {}

  public async upsert(untrustedInput: ListingProjectionInput): Promise<void> {
    const failure = await this.gateway.upsert(
      toListingProjectionRow(untrustedInput),
    );
    if (failure !== null) {
      throw new Error(
        `Failed to upsert AutoGe listing projection: ${failure.message}`,
      );
    }
  }
}

export function createSupabaseListingProjectionRepository(
  config: SupabaseConfig,
): SupabaseListingProjectionRepository {
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

  const gateway: ListingProjectionUpsertGateway = {
    async upsert(row): Promise<ProjectionUpsertFailure | null> {
      const { error } = await client
        .from("autoge_listing_projections")
        .upsert(row, { onConflict: "listing_id" });
      return error === null ? null : { message: error.message };
    },
  };

  return new SupabaseListingProjectionRepository(gateway);
}

export function toListingProjectionRow(
  untrustedInput: ListingProjectionInput,
): ListingProjectionRow {
  const { observation, observedAt, sourceEventId, projectionVersion } =
    listingProjectionInputSchema.parse(untrustedInput);

  return {
    listing_id: observation.listingId,
    canonical_url: observation.url,
    title: `${observation.make}, ${observation.model}`,
    make: observation.make,
    model: observation.model,
    year: observation.year ?? null,
    mileage: observation.mileage ?? null,
    mileage_unit: observation.mileageUnit ?? null,
    price_amount: observation.priceAmount ?? null,
    price_currency: observation.priceCurrency ?? null,
    customs_status: observation.customsStatus ?? null,
    drivetrain: observation.drivetrain ?? null,
    location: observation.location ?? null,
    phone_collection_status: observation.phoneCollectionStatus,
    seller_phone_numbers: observation.sellerPhoneNumbers.map((phoneNumber) => ({
      ...phoneNumber,
    })),
    observed_at: observedAt,
    source_event_id: sourceEventId,
    projection_version: projectionVersion,
  };
}
