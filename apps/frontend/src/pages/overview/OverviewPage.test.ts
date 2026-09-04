import { describe, expect, it } from "vitest";

import type { ActivityItem } from "../../api/types";
import {
  activityKey,
  activityPath,
  activityPresentation,
  activityResourceLabel,
  browserTestNoun,
  compactTime,
  responsePercentile,
  safeHost,
  usageSegmentCount,
  uptimeMetric,
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

  it("formats the 30-day uptime without inventing missing data", () => {
    expect(uptimeMetric(99.987)).toEqual({ value: "99.99", unit: "%" });
    expect(uptimeMetric(null)).toEqual({ value: "—", unit: null });
    expect(uptimeMetric(undefined)).toEqual({ value: "—", unit: null });
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
      MONITOR_DOWN: "Incident opened",
      MONITOR_RECOVERED: "Recovered",
      TEST_FAILED: "Failed",
      TEST_PASSED: "Passed",
      TEST_RECOVERED: "Recovered",
      TEST_SYSTEM_ERROR: "System error",
      TEST_TIMEOUT: "Timeout",
    });
  });

  it("keeps credentials and paths out of inventory host labels", () => {
    expect(safeHost("https://user:secret@example.com/private?token=x")).toBe(
      "example.com",
    );
    expect(safeHost("not a url")).toBe("Unknown host");
  });

  it("calculates response percentiles without mutating missing data", () => {
    expect(responsePercentile([40, 10, 20, 30], 0.5)).toBe(20);
    expect(responsePercentile([10, 20, 30, 40])).toBe(40);
    expect(responsePercentile([])).toBeNull();
  });

  it("maps aggregate usage to exact quota segments", () => {
    expect(usageSegmentCount(171, 300)).toBe(17);
    expect(usageSegmentCount(300, 300)).toBe(30);
    expect(usageSegmentCount(350, 300)).toBe(30);
    expect(usageSegmentCount(0, 300)).toBe(0);
    expect(usageSegmentCount(10, 0)).toBe(0);
  });

  it("uses compact overview-relative labels", () => {
    const now = Date.now();
    expect(compactTime(new Date(now).toISOString())).toBe("now");
    expect(compactTime(new Date(now - 3 * 60 * 60_000).toISOString())).toBe("3h ago");
    expect(compactTime(new Date(now + 4 * 60_000).toISOString())).toBe("in 4m");
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
