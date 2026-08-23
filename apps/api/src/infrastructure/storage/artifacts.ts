import type { ArtifactType } from "../../domain/browser_tests/types";

export function artifactStorageKey(input: {
  workspaceId: string;
  runId: string;
  attemptId: string;
  artifactId: string;
  type: ArtifactType;
}): string {
  const extension = input.type === "SCREENSHOT" ? "jpg" : "md";
  return `ws/${input.workspaceId}/run/${input.runId}/att/${input.attemptId}/${input.artifactId}.${extension}`;
}

export class ArtifactStorage {
  constructor(private readonly bucket: R2Bucket) {}

  async put(
    key: string,
    bytes: Uint8Array | ArrayBuffer,
    contentType: string,
  ): Promise<{ sizeBytes: number }> {
    await this.bucket.put(key, bytes, { httpMetadata: { contentType } });
    return { sizeBytes: bytes.byteLength };
  }

  get(key: string): Promise<R2ObjectBody | null> {
    return this.bucket.get(key);
  }

  async delete(keys: string[]): Promise<void> {
    const unique = [...new Set(keys)];
    for (let index = 0; index < unique.length; index += 1_000) {
      await this.bucket.delete(unique.slice(index, index + 1_000));
    }
  }

  /** Deletes every object under a workspace prefix, including orphaned R2
   * objects whose D1 artifact insert failed after upload. */
  async deletePrefix(prefix: string): Promise<void> {
    let cursor: string | undefined;
    do {
      const page = await this.bucket.list({ prefix, cursor });
      const keys = page.objects.map((object) => object.key);
      if (keys.length > 0) await this.delete(keys);
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor !== undefined);
  }
}
