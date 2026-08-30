import { describe, expect, it } from "vitest";

import {
  ANALYTICS_ROUTE_PATTERNS,
  ROUTE_EVENTS,
  analyticsClassificationFor,
  analyticsRoutePatternFor,
  visitEventFor,
} from "./route-events";

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
      "/w/:wsId/incidents", "/w/:wsId/incidents/:incidentId", "/w/:wsId/status-pages", "/w/:wsId/status-pages/:pageId",
      "/w/:wsId/alerts", "/w/:wsId/alerts/sms-calls",
      "/w/:wsId/secrets", "/w/:wsId/members", "/w/:wsId/billing", "/w/:wsId/settings",
    ];
    expect(ROUTE_EVENTS.map((entry) => entry.pattern).sort()).toEqual(expected.sort());
  });
});

describe("analyticsRoutePatternFor", () => {
  it("collapses concrete workspace and resource IDs to allow-listed templates", () => {
    expect(
      analyticsRoutePatternFor("/w/customer-123/tests/test-secret/edit"),
    ).toBe("/w/:wsId/tests/:testId/edit");
    expect(
      analyticsRoutePatternFor("/w/customer-123/status-pages/status-secret"),
    ).toBe("/w/:wsId/status-pages/:pageId");
  });

  it("collapses capability-bearing paths so real tokens are never returned", () => {
    expect(analyticsRoutePatternFor("/invitations/very-secret-token")).toBe(
      "/invitations/:token",
    );
    expect(analyticsRoutePatternFor("/grants/another-secret-token")).toBe(
      "/grants/:token",
    );
  });

  it("receives pathname only and never adds query strings or fragments", () => {
    expect(analyticsRoutePatternFor("/verify-email")).toBe("/verify-email");
    expect(analyticsRoutePatternFor("/w/ws_1/incidents")).toBe(
      "/w/:wsId/incidents",
    );
    expect(analyticsRoutePatternFor("/verify-email?token=secret")).toBe("/404");
    expect(analyticsRoutePatternFor("/reset-password#secret")).toBe("/404");
  });

  it("uses a fixed 404 label for unknown paths and skips redirects", () => {
    expect(analyticsRoutePatternFor("/unknown/person@example.com")).toBe("/404");
    expect(analyticsRoutePatternFor("/")).toBeNull();
    expect(analyticsRoutePatternFor("/w/ws_1")).toBeNull();
    expect(analyticsRoutePatternFor("/w/ws_1/notifications")).toBeNull();
  });
});

describe("analyticsClassificationFor", () => {
  it("classifies every allow-listed route into finite reporting groups", () => {
    for (const routePattern of ANALYTICS_ROUTE_PATTERNS) {
      expect(analyticsClassificationFor(routePattern)).not.toBeNull();
    }
    expect(analyticsClassificationFor("/w/real/tests/secret")).toBeNull();
  });

  it("separates auth, onboarding, product, billing, legal and errors", () => {
    expect(analyticsClassificationFor("/signup")).toEqual({
      appSection: "auth",
      contentGroup: "app_auth",
    });
    expect(analyticsClassificationFor("/w/:wsId/setup/billing")).toEqual({
      appSection: "onboarding",
      contentGroup: "app_onboarding",
    });
    expect(analyticsClassificationFor("/w/:wsId/tests/:testId")).toEqual({
      appSection: "tests",
      contentGroup: "app_product",
    });
    expect(analyticsClassificationFor("/w/:wsId/billing")).toEqual({
      appSection: "billing",
      contentGroup: "app_billing",
    });
    expect(analyticsClassificationFor("/privacy")).toEqual({
      appSection: "legal",
      contentGroup: "app_legal",
    });
    expect(analyticsClassificationFor("/404")).toEqual({
      appSection: "error",
      contentGroup: "error",
    });
  });
});
