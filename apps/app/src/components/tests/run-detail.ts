import type { AttemptSummary } from "@/api/types";
import { isUnavailableItem, unavailableItemMessage } from "@/lib/errors";

export const reportNote =
  "The report describes what was observed. It contains no credentials and doesn't assert an unverified root cause.";
export const draftValidationNote =
  "This was a validation run of an unsaved draft. It doesn't open incidents or send alerts.";
export const expiredRunMessage = unavailableItemMessage;

export function isMissingRun(error: unknown): boolean {
  return isUnavailableItem(error);
}

/** The first failed attempt is the interesting one; otherwise the latest. */
export function defaultExpandedAttemptId(attempts: AttemptSummary[]): string | null {
  return (
    attempts.find((attempt) => attempt.status === "FAILED")?.id ??
    attempts[attempts.length - 1]?.id ??
    null
  );
}
