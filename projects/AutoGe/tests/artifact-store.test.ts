import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ContentAddressedArtifactStore } from "../src/storage/artifact-store.js";

describe("ContentAddressedArtifactStore", () => {
  it("stores sanitized bytes by sha256 and deduplicates them", async () => {
    const root = await mkdtemp(join(tmpdir(), "autoge-artifacts-"));
    const store = new ContentAddressedArtifactStore(root);

    const first = await store.put(
      Buffer.from("listing snapshot"),
      "text/plain",
    );
    const second = await store.put(
      Buffer.from("listing snapshot"),
      "text/plain",
    );

    expect(second).toEqual(first);
    expect(first.relativePath).toMatch(
      /^objects\/sha256\/[a-f0-9]{2}\/[a-f0-9]{64}$/,
    );
    await expect(
      readFile(join(root, first.relativePath), "utf8"),
    ).resolves.toBe("listing snapshot");
  });
});
