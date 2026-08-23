/** The three windows `/api/analytics` accepts; anything else is a 400. */
export const RANGES = [7, 30, 90] as const;

export type RangeDays = (typeof RANGES)[number];

export const DEFAULT_RANGE: RangeDays = 30;

export const RANGE_STORAGE_KEY = "zenguy-admin:range";

export function parseRange(raw: string | null): RangeDays {
  const parsed = Number(raw);
  return RANGES.find((days) => days === parsed) ?? DEFAULT_RANGE;
}

/**
 * The operator's last window. Storage is best-effort: a panel opened in a private
 * window with storage blocked still boots on the default range.
 */
export function readStoredRange(): RangeDays {
  try {
    return parseRange(window.localStorage.getItem(RANGE_STORAGE_KEY));
  } catch {
    return DEFAULT_RANGE;
  }
}

export function storeRange(days: RangeDays): void {
  try {
    window.localStorage.setItem(RANGE_STORAGE_KEY, String(days));
  } catch {
    // A window that cannot remember the range is still a working panel.
  }
}
