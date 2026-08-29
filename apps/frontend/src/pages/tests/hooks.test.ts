import { describe, expect, it } from "vitest";

import type { BrowserTest } from "../../api/types";
import { isActiveRun, runCostCopy } from "./hooks";

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
            durationMs: 20_000,
            finishedAt: test.updatedAt,
            id: "run_completed",
            passedAfterRetry: false,
            source: "SCHEDULED",
            startedAt: test.createdAt,
            status: "PASSED",
          },
          recentRuns: [
            {
              finishedAt: test.updatedAt,
              id: "run_completed",
              status: "PASSED",
            },
            { finishedAt: null, id: "run_active", status },
          ],
        }),
      ).toBe(true);
    }
  });

  it("keeps compatibility with an active lastRun when history is absent", () => {
    expect(
      isActiveRun({
        ...test,
        lastRun: {
          createdAt: test.createdAt,
          durationMs: null,
          finishedAt: null,
          id: "run_legacy",
          passedAfterRetry: false,
          source: "MANUAL",
          startedAt: null,
          status: "RUNNING",
        },
      }),
    ).toBe(true);
  });
});
