import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import type { BrowserTest, RunListItem } from "../../api/types";
import {
  durationPercentage,
  parseRunFilter,
  performanceLegendItems,
  recentPerformanceSummary,
  recentRunHistory,
  runColumns,
} from "./TestDetailPage";

const test: BrowserTest = {
  channelIds: [],
  createdAt: "2026-08-01T10:00:00.000Z",
  createdBy: null,
  device: "DESKTOP",
  id: "test_1",
  instructions: "Open the shop and add an item to the cart.",
  intervalHours: 1,
  lastRun: null,
  maxRetries: 2,
  name: "Checkout",
  nextRunAt: "2026-08-29T11:00:00.000Z",
  notifyOnRecovery: true,
  openIncidentId: null,
  startUrl: "https://example.com",
  updatedAt: "2026-08-01T10:00:00.000Z",
};

function run(
  id: string,
  createdAt: string,
  overrides: Partial<RunListItem> = {},
): RunListItem {
  return {
    attemptCount: 2,
    billable: true,
    createdAt,
    device: "DESKTOP",
    durationMs: 12_000,
    id,
    passedAfterRetry: true,
    source: "SCHEDULED",
    status: "PASSED",
    triggeredBy: { name: "Marcos", userId: "user_1" },
    ...overrides,
  };
}

describe("test detail run filters", () => {
  it("accepts only API-supported status filters", () => {
    for (const status of ["PASSED", "FAILED", "TIMEOUT", "SYSTEM_ERROR"] as const) {
      expect(parseRunFilter(status)).toBe(status);
    }
    expect(parseRunFilter(null)).toBe("ALL");
    expect(parseRunFilter("RUNNING")).toBe("ALL");
    expect(parseRunFilter("not-a-status")).toBe("ALL");
  });
});

describe("test detail history", () => {
  it("keeps the latest 20 results and returns them oldest first without mutating input", () => {
    const newestFirst = Array.from({ length: 25 }, (_, index) => {
      const number = 25 - index;
      return run(`run_${number}`, `2026-08-${String(number).padStart(2, "0")}T10:00:00.000Z`);
    });
    const originalOrder = newestFirst.map((item) => item.id);

    expect(recentRunHistory(newestFirst).map((item) => item.id)).toEqual(
      Array.from({ length: 20 }, (_, index) => `run_${index + 6}`),
    );
    expect(newestFirst.map((item) => item.id)).toEqual(originalOrder);
  });

  it("derives honest performance metrics from completed product results", () => {
    const runs = [
      run("direct", "2026-08-29T07:00:00.000Z", {
        attemptCount: 1,
        durationMs: 60_000,
        passedAfterRetry: false,
      }),
      run("retry", "2026-08-29T08:00:00.000Z", {
        attemptCount: 2,
        durationMs: 180_000,
      }),
      run("failed", "2026-08-29T09:00:00.000Z", {
        attemptCount: 2,
        durationMs: null,
        passedAfterRetry: false,
        status: "FAILED",
      }),
      run("active", "2026-08-29T10:00:00.000Z", {
        attemptCount: 0,
        durationMs: null,
        passedAfterRetry: false,
        status: "RUNNING",
      }),
    ];

    expect(recentPerformanceSummary(runs)).toEqual({
      averageDurationMs: 120_000,
      maxDurationMs: 180_000,
      passed: 2,
      retryCount: 2,
      retryPercentage: 67,
      total: 3,
    });
  });

  it("scales durations safely for charts and table tracks", () => {
    expect(durationPercentage(null, 10_000)).toBe(0);
    expect(durationPercentage(1_000, 0)).toBe(0);
    expect(durationPercentage(1_000, 100_000)).toBe(12);
    expect(durationPercentage(50_000, 100_000)).toBe(50);
    expect(durationPercentage(200_000, 100_000)).toBe(100);
  });

  it("labels every result tone present in the performance chart", () => {
    const labels = performanceLegendItems([
      { passedAfterRetry: true, status: "PASSED" },
      { passedAfterRetry: false, status: "TIMEOUT" },
      { passedAfterRetry: false, status: "FAILED" },
      { passedAfterRetry: false, status: "SYSTEM_ERROR" },
      { passedAfterRetry: false, status: "RUNNING" },
    ]).map((item) => item.label);

    expect(labels).toEqual([
      "Direct",
      "Retried / timeout",
      "Failed",
      "System error",
      "Active",
    ]);
    expect(
      performanceLegendItems([{ passedAfterRetry: false, status: "TIMEOUT" }])[1]
        ?.label,
    ).toBe("Timeout");
  });

  it("presents a compact linked run row with its operational evidence", () => {
    const columns = runColumns(test, "UTC", "ws_1");
    expect(columns.map((column) => column.key)).toEqual([
      "run",
      "result",
      "duration",
      "attempts",
      "origin",
      "open",
    ]);
    const item = run("run_1", "2026-08-29T10:00:00.000Z");
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(
          Fragment,
          null,
          ...columns.map((column) =>
            createElement("div", { key: column.key }, column.render(item)),
          ),
        ),
      ),
    );
    expect(html).toContain('href="/w/ws_1/runs/run_1"');
    expect(html).toContain("Scheduled");
    expect(html).toContain("Passed after retry");
    expect(html).toContain("12s");
    expect(html).toContain("2 of 3");
    expect(html).toContain("Scheduled");
    expect(html).toContain("1 billable run");
    expect(html).toContain("Open run from");
  });
});
