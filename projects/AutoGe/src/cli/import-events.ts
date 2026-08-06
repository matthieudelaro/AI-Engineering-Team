import { readFile } from "node:fs/promises";

import { z } from "zod";

import { domainEventSchema } from "../domain/event.js";
import {
  createSupabaseEventRepository,
  loadSupabaseConfig,
} from "../storage/supabase-event-repository.js";

const eventBatchSchema = z.array(domainEventSchema).min(1);

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  if (inputPath === undefined) {
    throw new Error("Usage: npm run import:events -- <events.json>");
  }

  const rawText = await readFile(inputPath, "utf8");
  const untrustedJson: unknown = JSON.parse(rawText) as unknown;
  const events = eventBatchSchema.parse(untrustedJson);
  const repository = createSupabaseEventRepository(
    loadSupabaseConfig(process.env),
  );

  for (const event of events) {
    await repository.append(event);
  }

  process.stdout.write(`Imported ${String(events.length)} AutoGe events.\n`);
}

await main();
