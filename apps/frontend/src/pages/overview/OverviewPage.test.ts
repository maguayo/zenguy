import { describe, expect, it } from "vitest";

import type { ActivityItem } from "../../api/types";
import {
  activityKey,
  activityPath,
  activityPresentation,
  activityResourceLabel,
  browserTestNoun,
} from "./OverviewPage";

const item: ActivityItem = {
  id: "activity_1",
  link: {},
  occurredAt: "2026-08-19T10:00:00.000Z",
  resourceId: "resource_1",
  resourceName: "Checkout",
  resourceType: "BROWSER_TEST",
  title: "Checkout passed",
  type: "TEST_PASSED",
};

describe("overview activity", () => {
  it("uses an accessible singular or plural browser-test label", () => {
    expect(browserTestNoun(1)).toBe("test");
    expect(browserTestNoun(0)).toBe("tests");
    expect(browserTestNoun(2)).toBe("tests");
  });

  it("maps every activity type to a presentation", () => {
    expect(Object.keys(activityPresentation).sort()).toEqual(
      [
        "TEST_PASSED",
        "TEST_FAILED",
        "TEST_TIMEOUT",
        "TEST_SYSTEM_ERROR",
        "TEST_RECOVERED",
        "MONITOR_DOWN",
        "MONITOR_RECOVERED",
        "CHANNEL_DELIVERY_FAILED",
      ].sort(),
    );
    expect(
      Object.fromEntries(
        Object.entries(activityPresentation).map(([type, value]) => [type, value.label]),
      ),
    ).toEqual({
      CHANNEL_DELIVERY_FAILED: "Delivery failed",
      MONITOR_DOWN: "Down",
      MONITOR_RECOVERED: "Recovered",
      TEST_FAILED: "Failed",
      TEST_PASSED: "Passed",
      TEST_RECOVERED: "Recovered",
      TEST_SYSTEM_ERROR: "System error",
      TEST_TIMEOUT: "Timed out",
    });
  });

  it("uses readable resource labels", () => {
    expect(activityResourceLabel("BROWSER_TEST")).toBe("Browser test");
    expect(activityResourceLabel("UPTIME_MONITOR")).toBe("Uptime monitor");
    expect(activityResourceLabel("NOTIFICATION_CHANNEL")).toBe(
      "Notification channel",
    );
    expect(activityResourceLabel("UNKNOWN")).toBe("Workspace activity");
  });

  it("routes activity using the most specific linked resource", () => {
    expect(activityPath("ws_1", { ...item, link: { runId: "run_1" } })).toBe(
      "/w/ws_1/runs/run_1",
    );
    expect(activityPath("ws_1", { ...item, link: { incidentId: "inc_1" } })).toBe(
      "/w/ws_1/incidents/inc_1",
    );
    expect(activityPath("ws_1", { ...item, link: { monitorId: "mon_1" } })).toBe(
      "/w/ws_1/uptime/mon_1",
    );
    expect(activityPath("ws_1", { ...item, link: { channelId: "ch_1" } })).toBe(
      "/w/ws_1/notifications?channel=ch_1",
    );
  });

  it("keeps multiple events for the same incident uniquely keyed", () => {
    const down = {
      ...item,
      id: "incident_1",
      occurredAt: "2026-08-19T10:00:00.000Z",
      type: "MONITOR_DOWN" as const,
    };
    const recovered = {
      ...down,
      occurredAt: "2026-08-19T10:05:00.000Z",
      type: "MONITOR_RECOVERED" as const,
    };

    expect(activityKey(down)).not.toBe(activityKey(recovered));
  });
});
