import { describe, expect, it } from "vitest";

import { ROUTE_EVENTS, visitEventFor } from "./route-events";

describe("visitEventFor", () => {
  it("maps resource pages to typed visits with the route pattern, never the concrete path", () => {
    expect(visitEventFor("/w/ws_1/tests/bt_9")).toEqual({
      type: "browser_test.viewed",
      workspaceId: "ws_1",
      resourceId: "bt_9",
      properties: { page: "/w/:wsId/tests/:testId" },
    });
    expect(visitEventFor("/w/ws_1/tests/bt_9/edit")?.properties.page).toBe("/w/:wsId/tests/:testId/edit");
    expect(visitEventFor("/w/ws_1/runs/run_2")).toMatchObject({ type: "run.viewed", resourceId: "run_2" });
    expect(visitEventFor("/w/ws_1/uptime/mon_3")).toMatchObject({ type: "uptime_monitor.viewed", resourceId: "mon_3" });
    expect(visitEventFor("/w/ws_1/uptime/mon_3/edit")).toMatchObject({ type: "uptime_monitor.viewed", resourceId: "mon_3" });
    expect(visitEventFor("/w/ws_1/incidents/inc_4")).toMatchObject({ type: "incident.viewed", resourceId: "inc_4" });
  });

  it("maps every other authenticated page to web.page_viewed", () => {
    expect(visitEventFor("/w/ws_1/overview")).toEqual({
      type: "web.page_viewed",
      workspaceId: "ws_1",
      properties: { page: "/w/:wsId/overview" },
    });
    expect(visitEventFor("/w/ws_1")).toBeNull(); // index redirect, not a page
    expect(visitEventFor("/w/ws_1/tests/new")).toMatchObject({ type: "web.page_viewed", properties: { page: "/w/:wsId/tests/new" } });
    expect(visitEventFor("/onboarding/workspace")).toEqual({ type: "web.page_viewed", properties: { page: "/onboarding/workspace" } });
    expect(visitEventFor("/complimentary")?.workspaceId).toBeUndefined();
    expect(visitEventFor("/w/ws_1/setup/billing")).toMatchObject({ workspaceId: "ws_1", properties: { page: "/w/:wsId/setup/billing" } });
  });

  it("ignores public and unknown paths", () => {
    for (const path of ["/signin", "/signup", "/forgot-password", "/reset-password", "/verify-email", "/invitations/abc", "/grants/abc", "/privacy", "/terms", "/legal-notice", "/cookies", "/", "/nope", "/verify-pending"]) {
      expect(visitEventFor(path)).toBeNull();
    }
  });

  it("covers every authenticated route declared in App.tsx", () => {
    const expected = [
      "/complimentary", "/onboarding/workspace", "/w/:wsId/setup/billing",
      "/w/:wsId/overview", "/w/:wsId/tests", "/w/:wsId/tests/new", "/w/:wsId/tests/:testId", "/w/:wsId/tests/:testId/edit",
      "/w/:wsId/runs/:runId", "/w/:wsId/uptime", "/w/:wsId/uptime/new", "/w/:wsId/uptime/:monitorId", "/w/:wsId/uptime/:monitorId/edit",
      "/w/:wsId/incidents", "/w/:wsId/incidents/:incidentId", "/w/:wsId/alerts", "/w/:wsId/alerts/sms-calls",
      "/w/:wsId/secrets", "/w/:wsId/members", "/w/:wsId/billing", "/w/:wsId/settings",
    ];
    expect(ROUTE_EVENTS.map((entry) => entry.pattern).sort()).toEqual(expected.sort());
  });
});
