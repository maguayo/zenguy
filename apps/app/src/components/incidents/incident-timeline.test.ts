import { describe, expect, it } from "@jest/globals";

import type { IncidentEvent } from "@/api/types";
import {
  deliveryStatusLabel,
  deliveryStatusTone,
  eventEvidenceIds,
  eventPresentation,
  sortedIncidentEvents,
  timelineChips,
} from "./incident-timeline";

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

const incident = { resourceId: "test_1", resourceType: "BROWSER_TEST" as const };

describe("incident timeline", () => {
  it("sorts events chronologically without mutating the response", () => {
    expect(sortedIncidentEvents(events).map(({ id }) => id)).toEqual(["event_1", "event_2"]);
    expect(events.map(({ id }) => id)).toEqual(["event_2", "event_1"]);
  });

  it("breaks timestamp ties by id", () => {
    const sameTime = events.map((event) => ({ ...event, createdAt: events[0]!.createdAt }));
    expect(sortedIncidentEvents(sameTime).map(({ id }) => id)).toEqual(["event_1", "event_2"]);
  });

  it("prefers evidence ids from metadata and falls back to safe message ids", () => {
    expect(eventEvidenceIds(events[0]!)).toEqual({ checkId: null, runId: "run_2" });
    expect(eventEvidenceIds(events[1]!)).toEqual({ checkId: null, runId: "run_1" });
    expect(
      eventEvidenceIds({
        ...events[1]!,
        message: "Check check_9 failed with HTTP 503",
        metadata: { checkId: "check_meta" },
      }),
    ).toEqual({ checkId: "check_meta", runId: null });
  });

  it("renders channel, delivery, and run evidence as navigable chips", () => {
    expect(timelineChips(events[0]!, incident, "ws_1")).toEqual([
      { key: "channel", label: "Ops", tone: "neutral" },
      { key: "status", label: "Sent", tone: "ok" },
      { href: "/w/ws_1/runs/run_2", key: "run", label: "Run run_2", mono: true, tone: "accent" },
    ]);
    expect(timelineChips(events[1]!, incident, "ws_1")).toEqual([
      { href: "/w/ws_1/runs/run_1", key: "run", label: "Run run_1", mono: true, tone: "accent" },
    ]);
    expect(
      timelineChips(
        { ...events[1]!, message: "Check check_9 failed", metadata: { status: "FAILED" } },
        { resourceId: "monitor_1", resourceType: "UPTIME_MONITOR" },
        "ws_1",
      ),
    ).toEqual([
      { key: "status", label: "Failed", tone: "danger" },
      {
        href: "/w/ws_1/uptime/monitor_1?check=check_9",
        key: "check",
        label: "Check check_9",
        mono: true,
        tone: "accent",
      },
    ]);
  });

  it("maps delivery statuses and event types to tones", () => {
    expect(deliveryStatusTone("SENT")).toBe("ok");
    expect(deliveryStatusTone("FAILED")).toBe("danger");
    expect(deliveryStatusTone("PENDING")).toBe("neutral");
    expect(deliveryStatusLabel("PENDING")).toBe("Pending");
    expect(eventPresentation.OPENED.tone).toBe("danger");
    expect(eventPresentation.RESOLVED.tone).toBe("ok");
    expect(eventPresentation.NOTIFICATION_FAILED.tone).toBe("warn");
    expect(eventPresentation.TEST_DELETED.tone).toBe("neutral");
  });
});
