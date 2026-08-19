import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";

import type { IncidentEvent } from "../api/types";
import {
  eventEvidenceIds,
  IncidentTimeline,
  sortedIncidentEvents,
} from "./IncidentTimeline";

const events: IncidentEvent[] = [
  {
    createdAt: "2026-08-19T10:02:00.000Z",
    id: "event_2",
    message: "Notification via Ops: SENT",
    metadata: { channelName: "Ops", runId: "run_2", status: "SENT" },
    type: "NOTIFICATION_SENT",
  },
  {
    createdAt: "2026-08-19T10:00:00.000Z",
    id: "event_1",
    message: "Run run_1 finished FAILED",
    metadata: null,
    type: "OPENED",
  },
];

describe("incident timeline", () => {
  it("sorts events chronologically without mutating the response", () => {
    expect(sortedIncidentEvents(events).map(({ id }) => id)).toEqual(["event_1", "event_2"]);
    expect(events.map(({ id }) => id)).toEqual(["event_2", "event_1"]);
  });

  it("prefers evidence ids from metadata and falls back to safe message ids", () => {
    expect(eventEvidenceIds(events[0] as IncidentEvent)).toEqual({
      checkId: null,
      runId: "run_2",
    });
    expect(eventEvidenceIds(events[1] as IncidentEvent)).toEqual({
      checkId: null,
      runId: "run_1",
    });
  });

  it("renders channel, delivery, and run evidence as navigable chips", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <IncidentTimeline
          events={events}
          incident={{ resourceId: "test_1", resourceType: "BROWSER_TEST" }}
          timezone="UTC"
          workspaceId="ws_1"
        />
      </MemoryRouter>,
    );
    expect(html.indexOf("Run run_1 finished FAILED")).toBeLessThan(
      html.indexOf("Notification via Ops: SENT"),
    );
    expect(html).toContain("Ops");
    expect(html).toContain("Sent");
    expect(html).toContain("/w/ws_1/runs/run_2");
  });
});
