import type { AttemptSummary, BrowserTest, Device, RunnerKind } from "@/api/types";
import { formatInterval } from "@/lib/format";

export function runnerLabel(kind: RunnerKind | null): "Primary" | "Fallback" | "—" {
  if (kind === "primary") return "Primary";
  if (kind === "fallback") return "Fallback";
  return "—";
}

/** "12,345 (11,000 in · 1,345 out)" when the split is known, the total otherwise. */
export function tokensLabel(
  attempt: Pick<AttemptSummary, "inputTokens" | "outputTokens" | "tokenUsage">,
): string {
  if (attempt.tokenUsage === null) return "—";
  const total = attempt.tokenUsage.toLocaleString("en-US");
  if (attempt.inputTokens === null && attempt.outputTokens === null) return total;
  const input = (attempt.inputTokens ?? 0).toLocaleString("en-US");
  const output = (attempt.outputTokens ?? 0).toLocaleString("en-US");
  return `${total} (${input} in · ${output} out)`;
}

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
