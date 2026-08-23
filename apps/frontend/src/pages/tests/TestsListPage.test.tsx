import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";

import type { BrowserTest } from "../../api/types";
import { ApiError } from "../../lib/api";
import {
  TestRowContent,
  alertChannelsLabel,
  importErrorMessage,
  importSummaryMessage,
  runSourceLabel,
  testHost,
  testListHeaders,
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
  openIncidentId: "incident_1",
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
    expect(testListHeaders).toEqual(["Test", "Last run", "Next run", "Alerts"]);
  });

  it("renders a rich identity, schedule, and incident state", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <TestRowContent test={test} timezone="Europe/Madrid" workspaceId="ws_1" />
      </MemoryRouter>,
    );
    expect(html).toContain("Checkout");
    expect(html).toContain(">example.com<");
    expect(html).toContain("Desktop");
    expect(html).toContain("Every 6 hours");
    expect(html).toContain("Not run yet");
    expect(html).toContain("No alert channels");
    expect(html).toContain("/w/ws_1/incidents/incident_1");
    expect(html).toContain("Open incident");
  });

  it("shows completed-run duration, source, and clear alert coverage", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <TestRowContent
          test={{
            ...test,
            channelIds: ["ch_email", "ch_push"],
            lastRun: {
              createdAt: "2026-08-19T09:58:00.000Z",
              durationMs: 90_000,
              finishedAt: "2026-08-19T10:00:00.000Z",
              id: "run_1",
              passedAfterRetry: false,
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
    expect(html).toContain("1m 30s");
    expect(html).toContain("Scheduled");
    expect(html).toContain("All clear");
    expect(html).toContain("2 alert channels");
  });

  it("uses safe host and metadata labels", () => {
    expect(testHost("https://user:secret@example.com/path?token=private")).toBe(
      "example.com",
    );
    expect(testHost("not a url")).toBe("Unknown host");
    expect(alertChannelsLabel(0)).toBe("No alert channels");
    expect(alertChannelsLabel(1)).toBe("1 alert channel");
    expect(alertChannelsLabel(3)).toBe("3 alert channels");
    expect(runSourceLabel("MANUAL")).toBe("Manual");
    expect(runSourceLabel("VALIDATION")).toBe("Validation");
  });
});
