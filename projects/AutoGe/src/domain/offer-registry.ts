import type { DomainEvent } from "./event.js";

export type OfferDisposition = "retained" | "rejected" | "unknown";
export type OfferContactStatus =
  | "confirmed"
  | "confirmed_with_duplicate"
  | "delivery_unknown"
  | "known_failed"
  | "not_contacted";

export interface SourcedEvent {
  readonly event: DomainEvent;
  readonly batch: string;
}

export interface OfferRegistryEntry {
  readonly listingId: string;
  readonly url?: string;
  readonly disposition: OfferDisposition;
  readonly dispositionReason?: string;
  readonly contactStatus: OfferContactStatus;
  readonly conversationId?: string;
  readonly sourceEvidence: readonly string[];
}

export interface MarkdownReport {
  readonly path: string;
  readonly markdown: string;
}

interface MutableOffer {
  readonly listingId: string;
  url?: string;
  disposition: OfferDisposition;
  dispositionReason?: string;
  dispositionRecordedAt?: string;
  sawConfirmedContact: boolean;
  sawContactAttempt: boolean;
  sawDeliveryUnknown: boolean;
  sawKnownFailure: boolean;
  sawDuplicate: boolean;
  conversationId?: string;
  readonly sourceEvidence: Set<string>;
}

const AUTO_GE_LISTING_URL =
  /https:\/\/www\.auto\.ge\/en\/auto\/[\w-]+\/[\w-]+\/[\w-]+-(\d+)\.html/g;
const AUTO_GE_SUBJECT = /^auto\.ge:(\d+)$/;
const CONVERSATION_SUBJECT = /^auto\.ge:conversation:(\d+)$/;
const REGISTRY_ROW = /^\|\s*(\d+)\s*\|/gm;

export function buildOfferRegistry(
  sourcedEvents: readonly SourcedEvent[],
): OfferRegistryEntry[] {
  const offers = new Map<string, MutableOffer>();

  for (const sourcedEvent of sourcedEvents) {
    for (const listingId of listingIdsForEvent(sourcedEvent.event)) {
      const offer = getOrCreateOffer(offers, listingId);
      applyEvent(offer, sourcedEvent);
    }
  }

  return [...offers.values()]
    .sort((left, right) => Number(left.listingId) - Number(right.listingId))
    .map((offer) => ({
      listingId: offer.listingId,
      ...(offer.url === undefined ? {} : { url: offer.url }),
      disposition: offer.disposition,
      ...(offer.dispositionReason === undefined
        ? {}
        : { dispositionReason: offer.dispositionReason }),
      contactStatus: contactStatus(offer),
      ...(offer.conversationId === undefined
        ? {}
        : { conversationId: offer.conversationId }),
      sourceEvidence: [...offer.sourceEvidence].sort(),
    }));
}

export function extractAnalyzedListingIds(markdown: string): string[] {
  return [...markdown.matchAll(AUTO_GE_LISTING_URL)]
    .map((match) => match[1])
    .filter((listingId): listingId is string => listingId !== undefined)
    .filter(
      (listingId, index, listingIds) => listingIds.indexOf(listingId) === index,
    )
    .sort((left, right) => Number(left) - Number(right));
}

export function extractRegistryListingIds(markdown: string): string[] {
  return [...markdown.matchAll(REGISTRY_ROW)]
    .map((match) => match[1])
    .filter((listingId): listingId is string => listingId !== undefined)
    .filter(
      (listingId, index, listingIds) => listingIds.indexOf(listingId) === index,
    )
    .sort((left, right) => Number(left) - Number(right));
}

export function assertAnalyzedOffersAreRegistered(
  reports: readonly MarkdownReport[],
  registeredListingIds: readonly string[],
): void {
  const registered = new Set(registeredListingIds);
  const omissions = reports.flatMap((report) =>
    extractAnalyzedListingIds(report.markdown)
      .filter((listingId) => !registered.has(listingId))
      .map((listingId) => `${report.path}: ${listingId}`),
  );

  if (omissions.length > 0) {
    throw new Error(
      `Analyzed Auto.ge listings are missing from the canonical registry:\n${omissions.join("\n")}`,
    );
  }
}

export function renderOfferRegistry(
  entries: readonly OfferRegistryEntry[],
  generatedFromEventsThrough: string,
  sourceBatches: readonly string[],
): string {
  const lines = [
    "# Canonical AutoGe offer registry",
    "",
    "This English registry is generated from the append-only structured event batches.",
    "Do not edit rows by hand; run `npm run registry:generate` after archiving events.",
    "Raw artifacts and contact details remain in ignored `data/` and are not copied here.",
    "",
    `- Offers: ${String(entries.length)}`,
    `- Event evidence through: ${generatedFromEventsThrough}`,
    `- Source batches: ${sourceBatches.map((batch) => `\`${batch}\``).join(", ")}`,
    "",
    "| Listing ID | Listing | Disposition | Contact evidence | Source evidence |",
    "| ---: | --- | --- | --- | --- |",
  ];

  for (const entry of entries) {
    const listing =
      entry.url === undefined ? "URL unknown" : `[Open listing](${entry.url})`;
    const disposition = `${entry.disposition}${
      entry.dispositionReason === undefined
        ? ""
        : ` — ${escapeTableCell(entry.dispositionReason)}`
    }`;
    const contact = `${entry.contactStatus}${
      entry.conversationId === undefined
        ? ""
        : ` (conversation ${entry.conversationId})`
    }`;
    lines.push(
      `| ${entry.listingId} | ${listing} | ${disposition} | ${contact} | ${entry.sourceEvidence
        .map(escapeTableCell)
        .join("<br>")} |`,
    );
  }

  return `${lines.join("\n")}\n`;
}

function listingIdsForEvent(event: DomainEvent): string[] {
  const listingIds = new Set<string>();
  const payloadListingId = stringValue(event.payload.listingId);
  if (payloadListingId !== undefined && /^\d+$/.test(payloadListingId)) {
    listingIds.add(payloadListingId);
  }

  if (event.subjectType === "listing") {
    const subjectMatch = AUTO_GE_SUBJECT.exec(event.subjectId);
    if (subjectMatch?.[1] !== undefined) {
      listingIds.add(subjectMatch[1]);
    }
  }

  const verifiedListingIds = event.payload.verifiedListingIds;
  if (Array.isArray(verifiedListingIds)) {
    for (const untrustedListingId of verifiedListingIds) {
      if (
        typeof untrustedListingId === "string" &&
        /^\d+$/.test(untrustedListingId)
      ) {
        listingIds.add(untrustedListingId);
      }
    }
  }

  return [...listingIds];
}

function getOrCreateOffer(
  offers: Map<string, MutableOffer>,
  listingId: string,
): MutableOffer {
  const existing = offers.get(listingId);
  if (existing !== undefined) {
    return existing;
  }

  const created: MutableOffer = {
    listingId,
    disposition: "unknown",
    sawConfirmedContact: false,
    sawContactAttempt: false,
    sawDeliveryUnknown: false,
    sawKnownFailure: false,
    sawDuplicate: false,
    sourceEvidence: new Set<string>(),
  };
  offers.set(listingId, created);
  return created;
}

function applyEvent(offer: MutableOffer, sourcedEvent: SourcedEvent): void {
  const { event, batch } = sourcedEvent;
  const url = stringValue(event.payload.url);
  if (url !== undefined) {
    assertUrlMatchesListing(url, offer.listingId);
    if (offer.url !== undefined && offer.url !== url) {
      throw new Error(
        `Conflicting URLs for Auto.ge listing ${offer.listingId}: ${offer.url} and ${url}`,
      );
    }
    offer.url = url;
  }

  offer.sourceEvidence.add(`${batch}:${event.eventType}:${event.source}`);
  const evidenceReports = event.payload.evidenceReports;
  if (Array.isArray(evidenceReports)) {
    for (const evidenceReport of evidenceReports) {
      if (typeof evidenceReport === "string" && evidenceReport.length > 0) {
        offer.sourceEvidence.add(`report:${evidenceReport}`);
      }
    }
  }

  if (event.eventType === "listing_disposition_recorded") {
    applyDisposition(offer, event);
  }

  if (event.eventType === "seller_message_sent") {
    offer.sawContactAttempt = true;
  }
  if (
    event.eventType === "seller_message_sent" ||
    event.eventType === "message_history_observed"
  ) {
    offer.sawConfirmedContact ||= event.payload.deliveryConfirmed === true;
    offer.sawDuplicate ||= numberValue(event.payload.duplicateCount) > 0;
  }
  if (
    event.eventType === "action_failed" &&
    event.payload.action === "seller_message_send"
  ) {
    offer.sawContactAttempt = true;
    offer.sawDeliveryUnknown ||= event.payload.status === "delivery_unknown";
    offer.sawKnownFailure ||= event.payload.status === "known_failed";
  }

  const conversationId =
    stringValue(event.payload.conversationId) ??
    CONVERSATION_SUBJECT.exec(event.subjectId)?.[1];
  if (conversationId !== undefined) {
    offer.conversationId = conversationId;
  }
}

function applyDisposition(offer: MutableOffer, event: DomainEvent): void {
  const disposition = event.payload.disposition;
  if (disposition !== "retained" && disposition !== "rejected") {
    throw new Error(
      `Invalid disposition for Auto.ge listing ${offer.listingId}: ${String(disposition)}`,
    );
  }
  const reason = stringValue(event.payload.reason);
  if (reason === undefined) {
    throw new Error(
      `Missing disposition reason for Auto.ge listing ${offer.listingId}`,
    );
  }

  if (
    offer.dispositionRecordedAt === undefined ||
    event.recordedAt >= offer.dispositionRecordedAt
  ) {
    offer.disposition = disposition;
    offer.dispositionReason = reason;
    offer.dispositionRecordedAt = event.recordedAt;
  }
}

function contactStatus(offer: MutableOffer): OfferContactStatus {
  if (offer.sawConfirmedContact) {
    return offer.sawDuplicate ? "confirmed_with_duplicate" : "confirmed";
  }
  if (offer.sawDeliveryUnknown) {
    return "delivery_unknown";
  }
  if (offer.sawKnownFailure) {
    return "known_failed";
  }
  return offer.sawContactAttempt ? "delivery_unknown" : "not_contacted";
}

function assertUrlMatchesListing(url: string, listingId: string): void {
  const matches = extractAnalyzedListingIds(url);
  if (matches.length !== 1 || matches[0] !== listingId) {
    throw new Error(`URL does not match Auto.ge listing ${listingId}: ${url}`);
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function escapeTableCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}
