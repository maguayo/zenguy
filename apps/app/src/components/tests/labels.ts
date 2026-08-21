import type { BrowserTest, Device } from "@/api/types";
import { formatInterval } from "@/lib/format";

export function deviceLabel(device: Device): "Desktop" | "Mobile" {
  return device === "DESKTOP" ? "Desktop" : "Mobile";
}

export function deviceDescription(device: Device): string {
  return device === "DESKTOP" ? "Desktop · 1440 × 900" : "Mobile · 390 × 844";
}

/** "Desktop · Every 6 hours" — the list row subtitle. */
export function testSubtitle(test: Pick<BrowserTest, "device" | "intervalHours">): string {
  return `${deviceLabel(test.device)} · ${formatInterval(test.intervalHours)}`;
}

export function retriesLabel(maxRetries: number): string {
  return `${maxRetries} ${maxRetries === 1 ? "retry" : "retries"}`;
}

/** "n of m" where m counts the first attempt plus every retry. */
export function attemptsLabel(attemptCount: number, maxRetries: number): string {
  return `${attemptCount} of ${maxRetries + 1}`;
}
