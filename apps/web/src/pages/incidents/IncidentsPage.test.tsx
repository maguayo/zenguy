import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Incident } from "../../api/types";
import {
  incidentColumns,
  liveIncidentDuration,
  nextIncidentSearchParams,
  openIncidentsDescription,
  parseIncidentStatus,
  parseIncidentType,
} from "./IncidentsPage";

const incident: Incident = {
  durationMs: 60_000,
  id: "incident_1",
  lastEventAt: "2026-08-19T10:01:00.000Z",
  openedAt: "2026-08-19T10:00:00.000Z",
  resolvedAt: null,
  resourceId: "monitor_1",
  resourceName: "Checkout API",
  resourceType: "UPTIME_MONITOR",
  status: "OPEN",
};

describe("incidents list", () => {
  it("defaults invalid query values and preserves shareable filters", () => {
    expect(parseIncidentStatus(null)).toBe("open");
    expect(parseIncidentStatus("resolved")).toBe("resolved");
    expect(parseIncidentStatus("unknown")).toBe("open");
    expect(parseIncidentType("uptime")).toBe("uptime");
    expect(parseIncidentType("unknown")).toBe("all");

    const next = nextIncidentSearchParams(
      new URLSearchParams("status=resolved&type=browser"),
      "from",
      "2026-08-01",
    );
    expect(next.toString()).toContain("status=resolved");
    expect(next.toString()).toContain("type=browser");
    expect(next.toString()).toContain("from=2026-08-01");
    expect(nextIncidentSearchParams(next, "status", "open").has("status")).toBe(false);
  });

  it("ticks open durations but preserves resolved durations", () => {
    expect(liveIncidentDuration(incident, Date.parse("2026-08-19T10:02:00.000Z"))).toBe(
      120_000,
    );
    expect(
      liveIncidentDuration(
        { ...incident, resolvedAt: "2026-08-19T10:01:00.000Z", status: "RESOLVED" },
        Date.parse("2026-08-19T12:00:00.000Z"),
      ),
    ).toBe(60_000);
  });

  it("keeps the required columns, resource type, and open status", () => {
    const columns = incidentColumns("UTC", Date.parse("2026-08-19T10:02:00.000Z"));
    expect(columns.map((column) => column.key)).toEqual([
      "resource",
      "status",
      "opened",
      "duration",
      "lastEvent",
    ]);
    const html = renderToStaticMarkup(
      <>{columns.map((column) => <div key={column.key}>{column.render(incident)}</div>)}</>,
    );
    expect(html).toContain("Checkout API");
    expect(html).toContain("Uptime monitor");
    expect(html).toContain("Open");
    expect(html).toContain("2m 00s");
  });

  it("keeps the open empty state copy verbatim", () => {
    expect(openIncidentsDescription).toBe(
      "Everything is passing. Incidents appear here when a test or monitor fails after all retries.",
    );
  });
});
