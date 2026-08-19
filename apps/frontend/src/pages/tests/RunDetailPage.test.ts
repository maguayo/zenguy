import { describe, expect, it } from "vitest";

import type { AttemptSummary } from "../../api/types";
import { ApiError } from "../../lib/api";
import {
  defaultExpandedAttemptId,
  draftValidationNote,
  expiredRunMessage,
  isMissingRun,
  reportNote,
} from "./RunDetailPage";

function attempt(id: string, status: AttemptSummary["status"]): AttemptSummary {
  return {
    attemptIndex: Number(id.at(-1) ?? 0),
    durationMs: null,
    failureReason: null,
    finishedAt: null,
    id,
    latestScreenshot: null,
    latestStep: null,
    queuedAt: "2026-08-19T10:00:00.000Z",
    retryDelaySeconds: 0,
    startedAt: null,
    status,
    summary: null,
  };
}

describe("run detail", () => {
  it("expands the first failed attempt, otherwise the last", () => {
    expect(
      defaultExpandedAttemptId([
        attempt("attempt_1", "PASSED"),
        attempt("attempt_2", "FAILED"),
        attempt("attempt_3", "FAILED"),
      ]),
    ).toBe("attempt_2");
    expect(
      defaultExpandedAttemptId([
        attempt("attempt_1", "PASSED"),
        attempt("attempt_2", "PASSED"),
      ]),
    ).toBe("attempt_2");
    expect(defaultExpandedAttemptId([])).toBeNull();
  });

  it("keeps the required report disclaimer verbatim", () => {
    expect(reportNote).toBe(
      "The report describes what was observed. It contains no credentials and doesn't assert an unverified root cause.",
    );
  });

  it("recognizes an expired or unknown run without masking other errors", () => {
    expect(
      isMissingRun(new ApiError("Not found", { code: "NOT_FOUND", status: 404 })),
    ).toBe(true);
    expect(
      isMissingRun(new ApiError("Unavailable", { code: "INTERNAL", status: 500 })),
    ).toBe(false);
    expect(expiredRunMessage).toBe(
      "This item is no longer available (data is kept for 30 days).",
    );
  });

  it("keeps the validation-run explanation verbatim", () => {
    expect(draftValidationNote).toBe(
      "This was a validation run of an unsaved draft. It doesn't open incidents or send alerts.",
    );
  });
});
