import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface StoredArtifact {
  readonly sha256: string;
  readonly mediaType: string;
  readonly byteSize: number;
  readonly relativePath: string;
}

export class ContentAddressedArtifactStore {
  public constructor(private readonly rootDirectory: string) {}

  public async put(
    bytes: Uint8Array,
    mediaType: string,
  ): Promise<StoredArtifact> {
    if (mediaType.trim().length === 0) {
      throw new Error("Artifact media type must not be empty.");
    }

    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const relativePath = join("objects", "sha256", sha256.slice(0, 2), sha256);
    const absolutePath = join(this.rootDirectory, relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });

    try {
      await writeFile(absolutePath, bytes, { flag: "wx" });
    } catch (error: unknown) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }
    }

    return {
      sha256,
      mediaType,
      byteSize: bytes.byteLength,
      relativePath,
    };
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as Error & { readonly code: unknown }).code === "EEXIST"
  );
}
