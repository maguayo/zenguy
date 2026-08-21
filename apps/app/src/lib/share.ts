import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

function safeFilename(filename: string): string {
  const base = filename.split(/[\\/]+/u).filter(Boolean).pop() ?? "";
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/gu, "_").replace(/^[._]+/u, "");
  return cleaned.length > 0 ? cleaned.slice(0, 120) : "download.txt";
}

/**
 * Hands a text document (report, export) to the iOS share sheet. The file is
 * written to the app's cache directory, which the system may purge at any time.
 */
export async function shareTextFile(filename: string, text: string, mimeType: string): Promise<void> {
  const file = new File(Paths.cache, safeFilename(filename));
  if (file.exists) file.delete();
  file.write(text);
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Sharing is not available on this device.");
  }
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: filename });
}

export { safeFilename };
