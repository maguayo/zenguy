import { ArtifactStorage, artifactStorageKey } from "./artifacts";

describe("ArtifactStorage", () => {
  it("uses the canonical keys and stores the content type and byte size", async () => {
    const puts: { key: string; value: unknown; options: unknown }[] = [];
    const bucket = {
      async put(key: string, value: unknown, options: unknown) {
        puts.push({ key, value, options });
        return {};
      },
      async get() {
        return null;
      },
      async delete() {},
    } as unknown as R2Bucket;
    const storage = new ArtifactStorage(bucket);
    const screenshotKey = artifactStorageKey({
      workspaceId: "ws_1",
      runId: "run_1",
      attemptId: "att_1",
      artifactId: "art_1",
      type: "SCREENSHOT",
    });
    const reportKey = artifactStorageKey({
      workspaceId: "ws_1",
      runId: "run_1",
      attemptId: "att_1",
      artifactId: "art_2",
      type: "MARKDOWN_REPORT",
    });
    expect(screenshotKey).toBe("ws/ws_1/run/run_1/att/att_1/art_1.jpg");
    expect(reportKey).toBe("ws/ws_1/run/run_1/att/att_1/art_2.md");

    const bytes = new Uint8Array([1, 2, 3]);
    await expect(storage.put(screenshotKey, bytes, "image/jpeg")).resolves.toEqual({
      sizeBytes: 3,
    });
    expect(puts).toEqual([
      {
        key: screenshotKey,
        value: bytes,
        options: { httpMetadata: { contentType: "image/jpeg" } },
      },
    ]);
  });

  it("deduplicates delete keys and sends batches no larger than 1000", async () => {
    const deletions: string[][] = [];
    const bucket = {
      async put() {
        return {};
      },
      async get() {
        return null;
      },
      async delete(keys: string | string[]) {
        deletions.push(typeof keys === "string" ? [keys] : keys);
      },
    } as unknown as R2Bucket;
    const keys = Array.from({ length: 2_005 }, (_, index) => `key-${index}`);
    await new ArtifactStorage(bucket).delete([...keys, "key-0"]);
    expect(deletions.map((batch) => batch.length)).toEqual([1_000, 1_000, 5]);
    expect(deletions.flat()).toEqual(keys);
  });
});
