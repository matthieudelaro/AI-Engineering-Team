import { z } from "zod";

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
  .strict();

export type DomainEvent = z.infer<typeof domainEventSchema>;
