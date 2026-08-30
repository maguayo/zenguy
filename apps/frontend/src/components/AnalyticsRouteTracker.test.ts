import { describe, expect, it, vi } from "vitest";

import { syncAnalyticsRoute } from "./AnalyticsRouteTracker";

describe("syncAnalyticsRoute", () => {
  it("does not emit another page view when only the query string changes", () => {
    const trackPageView = vi.fn(() => true);
    const updatePageContext = vi.fn(() => true);
    const api = { trackPageView, updatePageContext };

    const pathname = "/w/ws_1/incidents";
    const first = syncAnalyticsRoute(
      null,
      pathname,
      "/w/:wsId/incidents",
      { authState: "signed_in_verified" },
      api,
    );
    const afterQueryChange = syncAnalyticsRoute(
      first,
      pathname,
      "/w/:wsId/incidents",
      { authState: "signed_in_verified" },
      api,
    );

    expect(afterQueryChange).toBe(pathname);
    expect(trackPageView).toHaveBeenCalledOnce();
    expect(updatePageContext).toHaveBeenCalledOnce();
  });

  it("emits views for distinct concrete resources sharing one route pattern", () => {
    const trackPageView = vi.fn(() => true);
    const updatePageContext = vi.fn(() => true);
    const api = { trackPageView, updatePageContext };
    const routePattern = "/w/:wsId/tests/:testId";

    const first = syncAnalyticsRoute(
      null,
      "/w/ws_1/tests/test_1",
      routePattern,
      { authState: "signed_in_verified" },
      api,
    );
    const second = syncAnalyticsRoute(
      first,
      "/w/ws_1/tests/test_2",
      routePattern,
      { authState: "signed_in_verified" },
      api,
    );

    expect(second).toBe("/w/ws_1/tests/test_2");
    expect(trackPageView).toHaveBeenCalledTimes(2);
    expect(updatePageContext).not.toHaveBeenCalled();
  });

  it("refreshes role and subscription context on the same path without a view", () => {
    const trackPageView = vi.fn(() => true);
    const updatePageContext = vi.fn(() => true);
    const api = { trackPageView, updatePageContext };
    const pathname = "/w/ws_1/overview";
    const routePattern = "/w/:wsId/overview";

    const first = syncAnalyticsRoute(
      null,
      pathname,
      routePattern,
      {
        authState: "signed_in_verified",
        subscriptionStatus: "NONE",
        workspaceRole: "MEMBER",
      },
      api,
    );
    syncAnalyticsRoute(
      first,
      pathname,
      routePattern,
      {
        authState: "signed_in_verified",
        subscriptionStatus: "ACTIVE",
        workspaceRole: "OWNER",
      },
      api,
    );

    expect(trackPageView).toHaveBeenCalledOnce();
    expect(updatePageContext).toHaveBeenCalledWith(routePattern, {
      authState: "signed_in_verified",
      subscriptionStatus: "ACTIVE",
      workspaceRole: "OWNER",
    });
  });
});
