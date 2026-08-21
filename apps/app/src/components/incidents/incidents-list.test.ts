import { describe, expect, it } from "@jest/globals";

import type { Incident } from "@/api/types";
import {
  hasOpenIncident,
  incidentFilters,
  liveIncidentDuration,
  openIncidentsDescription,
  parseIncidentStatus,
  parseIncidentType,
  resourceTypePresentation,
} from "./incidents-list";

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
  it("defaults invalid query values and reads the first of repeated params", () => {
    expect(parseIncidentStatus(null)).toBe("open");
    expect(parseIncidentStatus(undefined)).toBe("open");
    expect(parseIncidentStatus("resolved")).toBe("resolved");
    expect(parseIncidentStatus("all")).toBe("all");
    expect(parseIncidentStatus("unknown")).toBe("open");
    expect(parseIncidentStatus(["resolved", "open"])).toBe("resolved");
    expect(parseIncidentType("uptime")).toBe("uptime");
    expect(parseIncidentType("browser")).toBe("browser");
    expect(parseIncidentType("unknown")).toBe("all");
    expect(parseIncidentType(null)).toBe("all");
  });

  it("only sends the non-default filters to the API", () => {
    expect(incidentFilters("open", "all")).toEqual({ status: "open" });
    expect(incidentFilters("all", "browser")).toEqual({ type: "browser" });
    expect(incidentFilters("all", "all")).toEqual({});
    expect(incidentFilters("resolved", "uptime")).toEqual({ status: "resolved", type: "uptime" });
  });

  it("ticks open durations but preserves resolved durations", () => {
    expect(liveIncidentDuration(incident, Date.parse("2026-08-19T10:02:00.000Z"))).toBe(
      120_000,
    );
    expect(liveIncidentDuration(incident, Date.parse("2026-08-19T09:00:00.000Z"))).toBe(0);
    expect(
      liveIncidentDuration(
        { ...incident, resolvedAt: "2026-08-19T10:01:00.000Z", status: "RESOLVED" },
        Date.parse("2026-08-19T12:00:00.000Z"),
      ),
    ).toBe(60_000);
  });

  it("only keeps the clock running while an open incident is listed", () => {
    expect(hasOpenIncident([])).toBe(false);
    expect(hasOpenIncident([{ ...incident, status: "RESOLVED" }])).toBe(false);
    expect(hasOpenIncident([{ ...incident, status: "RESOLVED" }, incident])).toBe(true);
  });

  it("labels resource types like the web table", () => {
    expect(resourceTypePresentation("UPTIME_MONITOR")).toEqual({ label: "Uptime monitor", tone: "accent" });
    expect(resourceTypePresentation("BROWSER_TEST")).toEqual({ label: "Browser test", tone: "info" });
  });

  it("keeps the open empty state copy verbatim", () => {
    expect(openIncidentsDescription).toBe(
      "Everything is passing. Incidents appear here when a test or monitor fails after all retries.",
    );
  });
});
