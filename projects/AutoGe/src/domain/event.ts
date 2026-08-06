import { z } from "zod";

import {
  phoneCollectionStatusSchema,
  sellerPhoneNumbersSchema,
} from "../autoge/listing-parser.js";

const jsonValueSchema: z.ZodType = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const listingDiscoveredPayloadV2Schema = z
  .object({
    phoneCollectionStatus: phoneCollectionStatusSchema,
    sellerPhoneNumbers: sellerPhoneNumbersSchema,
  })
  .refine(
    ({ phoneCollectionStatus, sellerPhoneNumbers }) =>
      (phoneCollectionStatus === "observed"
        ? sellerPhoneNumbers.length > 0
        : sellerPhoneNumbers.length === 0) &&
      new Set(sellerPhoneNumbers.map(({ digits }) => digits)).size ===
        sellerPhoneNumbers.length,
    { message: "Phone collection status and phone numbers are inconsistent." },
  );

export const domainEventSchema = z
  .object({
    eventId: z.uuid(),
    eventType: z.string().min(1),
    occurredAt: z.iso.datetime(),
    recordedAt: z.iso.datetime(),
    subjectType: z.string().min(1),
    subjectId: z.string().min(1),
    causationId: z.uuid().optional(),
    correlationId: z.uuid().optional(),
    source: z.string().min(1),
    payload: z.record(z.string(), jsonValueSchema),
    rawArtifactId: z.uuid().optional(),
    schemaVersion: z.int().positive(),
  })
  .strict()
  .superRefine((event, context) => {
    if (event.eventType !== "listing_discovered" || event.schemaVersion < 2) {
      return;
    }

    const result = listingDiscoveredPayloadV2Schema.safeParse(event.payload);
    if (!result.success) {
      context.addIssue({
        code: "custom",
        message:
          "Listing discovery payload version 2 requires valid phone collection fields.",
        path: ["payload"],
      });
    }
  });

export type DomainEvent = z.infer<typeof domainEventSchema>;
