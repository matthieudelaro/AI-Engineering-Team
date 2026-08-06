import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

import { domainEventSchema } from "../domain/event.js";
import { SQLiteEventRepository } from "../storage/sqlite-event-repository.js";

const eventBatchSchema = z.array(domainEventSchema).min(1);

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  const databasePath = process.argv[3] ?? "data/autoge.sqlite";
  if (inputPath === undefined) {
    throw new Error(
      "Usage: npm run import:events:sqlite -- <events.json> [database.sqlite]",
    );
  }

  const rawText = await readFile(inputPath, "utf8");
  const untrustedJson: unknown = JSON.parse(rawText) as unknown;
  const events = eventBatchSchema.parse(untrustedJson);
  const repository = new SQLiteEventRepository(resolve(databasePath));

  try {
    repository.initialize();
    for (const event of events) {
      repository.append(event);
    }
    process.stdout.write(
      `SQLite contains ${String(repository.count())} AutoGe events.\n`,
    );
  } finally {
    repository.close();
  }
}

await main();
