import { describe, expect, it } from "vitest";

import type { ActivityItem } from "../../api/types";
import { activityPath, activityPresentation } from "./OverviewPage";

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
});
