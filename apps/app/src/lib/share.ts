import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

const SHARE_FILE_PREFIX = "zenguy-share-";

function safeFilename(filename: string): string {
  const base = filename.split(/[\\/]+/u).filter(Boolean).pop() ?? "";
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/gu, "_").replace(/^[._]+/u, "");
  return cleaned.length > 0 ? cleaned.slice(0, 120) : "download.txt";
}

export function temporaryShareFilename(filename: string, nonce?: string): string {
  const suffix = nonce ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${SHARE_FILE_PREFIX}${suffix}-${safeFilename(filename)}`;
}

function deleteIfPresent(file: File): void {
  try {
    if (file.exists) file.delete();
  } catch {
    // Cache cleanup is best-effort; the startup sweep retries stale files.
  }
}

/** Remove files left behind by a terminated share sheet on a previous launch. */
export async function cleanupSharedFiles(): Promise<void> {
  try {
    const cache = new Directory(Paths.cache);
    if (!cache.exists) return;
    for (const entry of cache.list()) {
      if (entry instanceof File && entry.name.startsWith(SHARE_FILE_PREFIX)) {
        deleteIfPresent(entry);
      }
    }
  } catch {
    // iOS owns eviction of the cache as a final fallback.
  }
}

/**
 * Hands a text document (report, export) to the iOS share sheet. The file is
 * written to the app's cache directory, which the system may purge at any time.
 */
export async function shareTextFile(filename: string, text: string, mimeType: string): Promise<void> {
  await cleanupSharedFiles();
  const file = new File(Paths.cache, temporaryShareFilename(filename));
  try {
    file.write(text);
    if (!(await Sharing.isAvailableAsync())) {
      throw new Error("Sharing is not available on this device.");
    }
    await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: filename });
  } finally {
    deleteIfPresent(file);
  }
}

export { safeFilename };
