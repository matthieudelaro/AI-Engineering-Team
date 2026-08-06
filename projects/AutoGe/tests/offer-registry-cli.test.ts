import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runOfferRegistry } from "../src/cli/offer-registry.js";
import type { DomainEvent } from "../src/domain/event.js";
import { renderOfferRegistry } from "../src/domain/offer-registry.js";

const listingUrl =
  "https://www.auto.ge/en/auto/ford/transit/ford-transit-1075336.html";

describe("offer registry CLI", () => {
  it("safely verifies the committed registry when ignored data is absent", async () => {
    const projectDirectory = await createProject();
    await writeReport(projectDirectory, listingUrl);
    await writeFile(
      join(projectDirectory, "OFFER-REGISTRY.md"),
      registryMarkdown(),
      "utf8",
    );

    await expect(
      runOfferRegistry({ projectDirectory, checkOnly: true }),
    ).resolves.toBe(
      "Verified 1 committed offers against narrative reports; local event batches are unavailable.\n",
    );
  });

  it("fails when a narrative report contains an unregistered offer", async () => {
    const projectDirectory = await createProject();
    await writeReport(
      projectDirectory,
      "https://www.auto.ge/en/auto/nissan/quest/nissan-quest-1047716.html",
    );
    await writeFile(
      join(projectDirectory, "OFFER-REGISTRY.md"),
      registryMarkdown(),
      "utf8",
    );

    await expect(
      runOfferRegistry({ projectDirectory, checkOnly: true }),
    ).rejects.toThrow("REPORT-2026-08-06.md: 1047716");
  });

  it("detects a stale registry after a new local event batch appears", async () => {
    const projectDirectory = await createProject();
    await writeReport(projectDirectory, listingUrl);
    await writeEventBatch(projectDirectory, eventsForListing());
    await runOfferRegistry({ projectDirectory, checkOnly: false });

    await writeFile(
      join(projectDirectory, "data", "research", "new-evidence.json"),
      JSON.stringify([
        event({
          eventId: "00000000-0000-4000-8000-000000000003",
          eventType: "message_history_observed",
          payload: { conversationId: "30052", deliveryConfirmed: true },
        }),
      ]),
      "utf8",
    );

    await expect(
      runOfferRegistry({ projectDirectory, checkOnly: true }),
    ).rejects.toThrow("OFFER-REGISTRY.md is stale");
  });

  it("generates a registry that immediately passes the check", async () => {
    const projectDirectory = await createProject();
    await writeReport(projectDirectory, listingUrl);
    await writeEventBatch(projectDirectory, eventsForListing());

    await expect(
      runOfferRegistry({ projectDirectory, checkOnly: false }),
    ).resolves.toBe("Generated OFFER-REGISTRY.md with 1 offers.\n");
    await expect(
      runOfferRegistry({ projectDirectory, checkOnly: true }),
    ).resolves.toBe(
      "Verified 1 offers against structured events and narrative reports.\n",
    );
    await expect(
      readFile(join(projectDirectory, "OFFER-REGISTRY.md"), "utf8"),
    ).resolves.toContain("| 1075336 |");
  });
});

async function createProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), "autoge-registry-cli-"));
}

async function writeReport(
  projectDirectory: string,
  url: string,
): Promise<void> {
  await writeFile(
    join(projectDirectory, "REPORT-2026-08-06.md"),
    `# Report\n\n[Analyzed listing](${url})\n`,
    "utf8",
  );
}

async function writeEventBatch(
  projectDirectory: string,
  events: readonly DomainEvent[],
): Promise<void> {
  const researchDirectory = join(projectDirectory, "data", "research");
  await mkdir(researchDirectory, { recursive: true });
  await writeFile(
    join(researchDirectory, "events.json"),
    JSON.stringify(events),
    "utf8",
  );
}

function eventsForListing(): DomainEvent[] {
  return [
    event({
      eventId: "00000000-0000-4000-8000-000000000001",
      eventType: "listing_observation_recovered",
      payload: { listingId: "1075336", url: listingUrl },
    }),
    event({
      eventId: "00000000-0000-4000-8000-000000000002",
      eventType: "listing_disposition_recorded",
      source: "autoge_car_finder",
      payload: {
        listingId: "1075336",
        disposition: "rejected",
        reason: "Vehicle is abroad.",
      },
    }),
  ];
}

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

function registryMarkdown(): string {
  return renderOfferRegistry(
    [
      {
        listingId: "1075336",
        url: listingUrl,
        disposition: "rejected",
        dispositionReason: "Vehicle is abroad.",
        contactStatus: "not_contacted",
        sourceEvidence: ["events.json:listing_discovered:auto.ge"],
      },
    ],
    "2026-08-06T10:00:01.000Z",
    ["events.json"],
  );
}
