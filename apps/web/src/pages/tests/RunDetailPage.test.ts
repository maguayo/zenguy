import { describe, expect, it } from "vitest";

import type { AttemptSummary } from "../../api/types";
import { defaultExpandedAttemptId, reportNote } from "./RunDetailPage";

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
});
