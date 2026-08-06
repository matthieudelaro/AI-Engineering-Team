import { readdir, readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { domainEventSchema, type DomainEvent } from "../domain/event.js";
import {
  assertAnalyzedOffersAreRegistered,
  buildOfferRegistry,
  extractRegistryListingIds,
  renderOfferRegistry,
  type MarkdownReport,
  type SourcedEvent,
} from "../domain/offer-registry.js";

export interface OfferRegistryCommandOptions {
  readonly projectDirectory: string;
  readonly checkOnly: boolean;
}

export async function runOfferRegistry(
  options: OfferRegistryCommandOptions,
): Promise<string> {
  const projectDirectory = resolve(options.projectDirectory);
  const dataDirectory = resolve(projectDirectory, "data");
  const registryPath = resolve(projectDirectory, "OFFER-REGISTRY.md");
  const reports = await loadReports(projectDirectory);
  const sourcedEvents = await loadEventBatches(dataDirectory, projectDirectory);

  if (sourcedEvents.length === 0) {
    if (!options.checkOnly) {
      throw new Error(
        "No structured event batches found under data/. Restore the local evidence before generating the registry.",
      );
    }
    const currentRegistry = await readFile(registryPath, "utf8");
    const registeredListingIds = extractRegistryListingIds(currentRegistry);
    assertAnalyzedOffersAreRegistered(reports, registeredListingIds);
    return `Verified ${String(registeredListingIds.length)} committed offers against narrative reports; local event batches are unavailable.\n`;
  }

  const entries = buildOfferRegistry(sourcedEvents);
  assertAnalyzedOffersAreRegistered(
    reports,
    entries.map((entry) => entry.listingId),
  );
  assertCompleteAuditFields(entries);

  const sourceBatches = [
    ...new Set(sourcedEvents.map((sourcedEvent) => sourcedEvent.batch)),
  ].sort();
  const generatedFromEventsThrough = sourcedEvents
    .map((sourcedEvent) => sourcedEvent.event.recordedAt)
    .sort()
    .at(-1);
  if (generatedFromEventsThrough === undefined) {
    throw new Error(
      "Cannot generate an offer registry without event timestamps.",
    );
  }

  const generatedRegistry = renderOfferRegistry(
    entries,
    generatedFromEventsThrough,
    sourceBatches,
  );

  if (options.checkOnly) {
    const currentRegistry = await readFile(registryPath, "utf8");
    if (currentRegistry !== generatedRegistry) {
      throw new Error(
        "OFFER-REGISTRY.md is stale. Run `npm run registry:generate` after archiving the event batch.",
      );
    }
    return `Verified ${String(entries.length)} offers against structured events and narrative reports.\n`;
  }

  await writeFile(registryPath, generatedRegistry, "utf8");
  return `Generated OFFER-REGISTRY.md with ${String(entries.length)} offers.\n`;
}

async function loadEventBatches(
  directory: string,
  projectDirectory: string,
): Promise<SourcedEvent[]> {
  const jsonPaths = await findFiles(directory, (path) =>
    path.endsWith(".json"),
  );
  const sourcedEvents: SourcedEvent[] = [];

  for (const jsonPath of jsonPaths) {
    const rawText = await readFile(jsonPath, "utf8");
    const untrustedJson: unknown = JSON.parse(rawText) as unknown;
    if (!looksLikeEventBatch(untrustedJson)) {
      continue;
    }
    const events = z.array(domainEventSchema).min(1).parse(untrustedJson);
    const batch = relative(projectDirectory, jsonPath);
    sourcedEvents.push(...events.map((event) => ({ event, batch })));
  }

  return sourcedEvents;
}

async function loadReports(directory: string): Promise<MarkdownReport[]> {
  const registryPath = resolve(directory, "OFFER-REGISTRY.md");
  const markdownPaths = await findFiles(
    directory,
    (path) => path.endsWith(".md") && path !== registryPath,
    false,
  );
  return Promise.all(
    markdownPaths.map(async (path) => ({
      path: relative(directory, path),
      markdown: await readFile(path, "utf8"),
    })),
  );
}

async function findFiles(
  directory: string,
  predicate: (path: string) => boolean,
  recursive = true,
): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error: unknown) {
    if (isMissingPathError(error)) {
      return [];
    }
    throw error;
  }

  const paths: string[] = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory() && recursive) {
      paths.push(...(await findFiles(path, predicate, recursive)));
    } else if (entry.isFile() && predicate(path)) {
      paths.push(path);
    }
  }
  return paths.sort();
}

function looksLikeEventBatch(value: unknown): value is DomainEvent[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        "eventId" in item &&
        "eventType" in item,
    )
  );
}

function assertCompleteAuditFields(
  entries: ReturnType<typeof buildOfferRegistry>,
): void {
  const incomplete = entries
    .filter(
      (entry) =>
        entry.url === undefined ||
        entry.disposition === "unknown" ||
        entry.sourceEvidence.length === 0,
    )
    .map((entry) => entry.listingId);
  if (incomplete.length > 0) {
    throw new Error(
      `Canonical offers lack URL, disposition, or source evidence: ${incomplete.join(", ")}`,
    );
  }
}

function isMissingPathError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as Error & { code?: unknown }).code === "ENOENT"
  );
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  resolve(invokedPath) === fileURLToPath(import.meta.url)
) {
  const output = await runOfferRegistry({
    projectDirectory: resolve("."),
    checkOnly: process.argv.includes("--check"),
  });
  process.stdout.write(output);
}
