import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";

import type { BrowserTest } from "../../api/types";
import { ApiError } from "../../lib/api";
import {
  TestRowContent,
  importErrorMessage,
  importSummaryMessage,
  runHistoryCaption,
  runSourceLabel,
  testHost,
  testIntervalLabel,
  testListHeaders,
  testStatus,
} from "./TestsListPage";

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
  recentRuns: [],
  startUrl: "https://example.com",
  updatedAt: "2026-08-19T10:00:00.000Z",
};

describe("import feedback", () => {
  it("summarizes created and updated counts", () => {
    expect(importSummaryMessage({ created: 3, updated: 2 })).toBe(
      "Import complete: 3 created, 2 updated",
    );
  });

  it("lists the first validation problems and counts the rest", () => {
    const error = new ApiError("Invalid request", {
      code: "VALIDATION_ERROR",
      status: 400,
      details: [
        { field: "tests.0.startUrl", message: "URL is not allowed" },
        { field: "tests.1.intervalHours", message: "Too big" },
        { field: "tests.2.name", message: "Too short" },
        { field: "tests.3.name", message: "Too short" },
      ],
    });
    expect(importErrorMessage(error)).toBe(
      "tests.0.startUrl: URL is not allowed; tests.1.intervalHours: Too big; tests.2.name: Too short (+1 more)",
    );
  });

  it("falls back to the plain API error message", () => {
    expect(importErrorMessage(new Error("boom"))).toBe("boom");
  });
});

describe("browser tests list", () => {
  it("keeps the required column order", () => {
    expect(testListHeaders).toEqual([
      "Status",
      "Test",
      "Every",
      "Last run",
      "Last 20 runs",
    ]);
  });

  it("draws compact linked history with a pass-rate caption", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <TestRowContent
          test={{
            ...test,
            recentRuns: [
              { finishedAt: "2026-08-19T04:00:00.000Z", id: "run_a", status: "FAILED" },
              { finishedAt: "2026-08-19T10:00:00.000Z", id: "run_b", status: "PASSED" },
            ],
          }}
          timezone="Europe/Madrid"
          workspaceId="ws_1"
        />
      </MemoryRouter>,
    );
    expect(html).toContain('href="/w/ws_1/runs/run_a"');
    expect(html).toContain('href="/w/ws_1/runs/run_b"');
    expect(html).toContain('aria-label="Failed ·');
    expect(html).toContain('aria-label="Passed ·');
    expect(html).toContain("bg-danger-600");
    expect(html).toContain("bg-ok-600");
    expect(html).toContain("h-[18px]");
    expect(html).toContain("1/2 passed");
  });

  it("invites the first run when there is no history yet", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <TestRowContent test={test} timezone="Europe/Madrid" workspaceId="ws_1" />
      </MemoryRouter>,
    );
    expect(html).toContain("No runs yet");
    expect(html).toContain("Not run yet");
  });

  it("renders a concise identity and schedule", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <TestRowContent test={test} timezone="Europe/Madrid" workspaceId="ws_1" />
      </MemoryRouter>,
    );
    expect(html).toContain("Checkout");
    expect(html).toContain("Desktop · example.com");
    expect(html).toContain("6 h");
    expect(html).toContain("Next ");
    expect(html).toContain("Not run yet");
    expect(html).toContain("Waiting for first run");
  });

  it("shows completed-run status, duration, source, and retry result", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <TestRowContent
          test={{
            ...test,
            lastRun: {
              createdAt: "2026-08-19T09:58:00.000Z",
              durationMs: 90_000,
              finishedAt: "2026-08-19T10:00:00.000Z",
              id: "run_1",
              passedAfterRetry: true,
              source: "SCHEDULED",
              startedAt: "2026-08-19T09:58:30.000Z",
              status: "PASSED",
            },
            openIncidentId: null,
          }}
          timezone="Europe/Madrid"
          workspaceId="ws_1"
        />
      </MemoryRouter>,
    );
    expect(html).toContain("Passed");
    expect(html).toContain("Passed after retry");
    expect(html).toContain("1m 30s");
    expect(html).toContain("Scheduled");
  });

  it("keeps the failure in the dedicated status cell", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <TestRowContent
          test={{
            ...test,
            lastRun: {
              createdAt: "2026-08-19T09:58:00.000Z",
              durationMs: 30_000,
              finishedAt: "2026-08-19T10:00:00.000Z",
              id: "run_failed",
              passedAfterRetry: false,
              source: "SCHEDULED",
              startedAt: "2026-08-19T09:59:30.000Z",
              status: "FAILED",
            },
            openIncidentId: null,
          }}
          timezone="Europe/Madrid"
          workspaceId="ws_1"
        />
      </MemoryRouter>,
    );
    expect(html).toContain("Failed");
    expect(html).not.toContain("Incident");
  });

  it("prioritises the newest active run over the last completed result", () => {
    const activeTest: BrowserTest = {
      ...test,
      lastRun: {
        createdAt: "2026-08-19T09:58:00.000Z",
        durationMs: 90_000,
        finishedAt: "2026-08-19T10:00:00.000Z",
        id: "run_passed",
        passedAfterRetry: false,
        source: "SCHEDULED",
        startedAt: "2026-08-19T09:58:30.000Z",
        status: "PASSED",
      },
      recentRuns: [
        { finishedAt: "2026-08-19T10:00:00.000Z", id: "run_passed", status: "PASSED" },
        { finishedAt: null, id: "run_running", status: "RUNNING" },
      ],
    };
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <TestRowContent test={activeTest} timezone="Europe/Madrid" workspaceId="ws_1" />
      </MemoryRouter>,
    );
    expect(testStatus(activeTest)).toBe("RUNNING");
    expect(html).toContain("Running");
    expect(html).toContain("1m 30s · Scheduled");
    expect(html).toContain("animate-pulse");
  });

  it("describes an active first run without claiming there is no history", () => {
    const activeTest: BrowserTest = {
      ...test,
      recentRuns: [{ finishedAt: null, id: "run_queued", status: "QUEUED" }],
    };
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <TestRowContent test={activeTest} timezone="Europe/Madrid" workspaceId="ws_1" />
      </MemoryRouter>,
    );
    expect(html).toContain("Queued");
    expect(html).toContain("Run in progress");
    expect(html).not.toContain("Not run yet");
  });

  it("uses safe host and metadata labels", () => {
    expect(testHost("https://user:secret@example.com/path?token=private")).toBe(
      "example.com",
    );
    expect(testHost("not a url")).toBe("Unknown host");
    expect(testIntervalLabel(1)).toBe("1 h");
    expect(testIntervalLabel(6)).toBe("6 h");
    expect(testIntervalLabel(0)).toBe("—");
    expect(runHistoryCaption([])).toBe("No runs yet");
    expect(runHistoryCaption([{ status: "RUNNING" }])).toBe("Run in progress");
    expect(runHistoryCaption([{ status: "SYSTEM_ERROR" }])).toBe(
      "No completed runs",
    );
    expect(runSourceLabel("MANUAL")).toBe("Manual");
    expect(runSourceLabel("VALIDATION")).toBe("Validation");
  });
});
