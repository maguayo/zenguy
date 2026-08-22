const VERSION_PATTERN = /^\d+(\.\d+){0,2}$/u;
const APP_STORE_HOST = "apps.apple.com";

/** "1.2.3" → [1, 2, 3]; missing components count as 0; anything else is null. */
export function parseVersion(value: string | null | undefined): number[] | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!VERSION_PATTERN.test(trimmed)) return null;
  const parts = trimmed.split(".").map((part) => Number.parseInt(part, 10));
  while (parts.length < 3) parts.push(0);
  return parts;
}

/** Negative when a < b, positive when a > b, 0 when equal. */
export function compareVersions(a: number[], b: number[]): number {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * Whether the running build must be updated. Unparseable versions never block
 * the app: a broken value must not lock everybody out.
 */
export function isUpdateRequired(current: string | null | undefined, minVersion: string): boolean {
  const installed = parseVersion(current);
  const minimum = parseVersion(minVersion);
  if (installed === null || minimum === null) return false;
  return compareVersions(installed, minimum) < 0;
}

/** Only App Store links are ever opened from the update screen. */
export function isAppStoreUrl(url: string | null | undefined): url is string {
  if (typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === APP_STORE_HOST;
  } catch {
    return false;
  }
}
