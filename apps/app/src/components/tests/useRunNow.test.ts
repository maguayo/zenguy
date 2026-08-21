import { describe, expect, it } from "@jest/globals";

import type { BrowserTest } from "@/api/types";
import { isActiveRun, runCostCopy } from "./useRunNow";

const test: BrowserTest = {
  channelIds: [],
  createdAt: "2026-08-19T10:00:00.000Z",
  createdBy: null,
  device: "DESKTOP",
  id: "test_1",
  instructions: "Check the page",
  intervalHours: 6,
  lastRun: null,
  maxRetries: 1,
  name: "Checkout",
  nextRunAt: "2026-08-19T16:00:00.000Z",
  notifyOnRecovery: true,
  openIncidentId: null,
  startUrl: "https://example.com",
  updatedAt: "2026-08-19T10:00:00.000Z",
};

describe("run-now flow", () => {
  it("uses the required run-cost copy", () => {
    expect(runCostCopy).toBe("This will use 1 run. Retries don't use additional runs.");
  });

  it("recognizes queued and running tests as active", () => {
    expect(isActiveRun(test)).toBe(false);
    for (const status of ["QUEUED", "RUNNING"] as const) {
      expect(
        isActiveRun({
          ...test,
          lastRun: {
            createdAt: test.createdAt,
            durationMs: null,
            finishedAt: null,
            id: "run_1",
            passedAfterRetry: false,
            source: "MANUAL",
            startedAt: null,
            status,
          },
        }),
      ).toBe(true);
    }
    expect(
      isActiveRun({
        ...test,
        lastRun: {
          createdAt: test.createdAt,
          durationMs: 1_000,
          finishedAt: test.createdAt,
          id: "run_1",
          passedAfterRetry: false,
          source: "SCHEDULED",
          startedAt: test.createdAt,
          status: "PASSED",
        },
      }),
    ).toBe(false);
  });
});
