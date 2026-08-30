import { describe, expect, it, vi } from "vitest";

import type { AlertsOverview } from "../api/types";
import {
  alertCreditBanner,
  appContentWidth,
  appContentWidthClass,
} from "./AppLayout";
import {
  accountMenuItems,
  navigationItems,
  visibleNavigationItems,
} from "./Sidebar";

const overview: AlertsOverview = {
  credit: null,
  destinations: [],
  pricing: { capturedOn: "2026-08-21", currency: "EUR", markup: 2, regions: [] },
  settings: { dailyPaidAlertLimit: 20, paidChannelsEnabled: true },
  status: { paidAlertsPaused: true, paidChannelCount: 2, pauseReason: "NO_CREDIT" },
  topUp: { available: true, maxPacks: 10, minPacks: 1, packCents: 1_000 },
};

describe("alert credit banner", () => {
  it("shows only when paid channels exist and the credit is empty", () => {
    expect(alertCreditBanner(undefined, true)).toBeNull();
    expect(alertCreditBanner(overview, true)).toEqual({
      message: "Alert credit is empty — SMS and call alerts are paused until you top up.",
      showTopUp: true,
    });
    expect(alertCreditBanner(overview, false)?.showTopUp).toBe(false);
    expect(
      alertCreditBanner(
        { ...overview, status: { ...overview.status, paidChannelCount: 0 } },
        true,
      ),
    ).toBeNull();
    expect(
      alertCreditBanner(
        { ...overview, status: { ...overview.status, pauseReason: "PAID_OFF" } },
        true,
      ),
    ).toBeNull();
  });
});

describe("app content width", () => {
  it("keeps operational lists fluid and anchors capped pages by content type", () => {
    expect(appContentWidth("/w/ws_1/tests")).toBe("fluid");
    expect(appContentWidth("/w/ws_1/uptime")).toBe("fluid");
    expect(appContentWidth("/w/ws_1/overview")).toBe("wide");
    expect(appContentWidth("/w/ws_1/tests/test_1")).toBe("wide");
    expect(appContentWidth("/w/ws_1/runs/run_1")).toBe("wide");
    expect(appContentWidth("/w/ws_1/settings")).toBe("standard");
    expect(appContentWidth("/w/ws_1/alerts/sms-calls")).toBe("standard");
    expect(appContentWidth("/w/ws_1/tests/new")).toBe("narrow");
    expect(appContentWidth("/w/ws_1/tests/test_1/edit")).toBe("narrow");
    expect(appContentWidth("/w/ws_1/uptime/new")).toBe("narrow");
  });

  it("defines only left-anchored width variants", () => {
    expect(appContentWidthClass).toEqual({
      fluid: "max-w-none",
      narrow: "max-w-[1120px]",
      standard: "max-w-[1440px]",
      wide: "max-w-[1920px]",
    });
    expect(Object.values(appContentWidthClass).join(" ")).not.toContain("mx-auto");
  });
});

describe("workspace navigation", () => {
  it("keeps the required navigation order", () => {
    expect(navigationItems.map((item) => item.label)).toEqual([
      "Overview",
      "Browser Tests",
      "Uptime",
      "Incidents",
      "Status Pages",
      "Alerts",
      "Secrets",
      "Members",
      "Plan & Usage",
      "Workspace Settings",
    ]);
  });

  it("hides billing when the role cannot view it", () => {
    const memberItems = visibleNavigationItems(() => false);
    expect(memberItems.map((item) => item.label)).not.toContain("Plan & Usage");
    expect(memberItems).toHaveLength(navigationItems.length - 1);
  });

  it("shows billing when the role can view it", () => {
    expect(visibleNavigationItems(() => true)).toEqual(navigationItems);
  });
});

describe("account menu", () => {
  const menu = ({
    cookiePreferencesAvailable = false,
    cookiePreferencesDecided = false,
    onNavigate = vi.fn(),
    openCookiePreferences = vi.fn(),
    signOut = vi.fn(),
  } = {}) =>
    accountMenuItems({
      cookiePreferencesAvailable,
      cookiePreferencesDecided,
      onNavigate,
      openCookiePreferences,
      signOut,
    });

  it("places cookie preferences immediately above sign out", () => {
    expect(
      menu({
        cookiePreferencesAvailable: true,
        cookiePreferencesDecided: true,
      }).map((item) => item.label),
    ).toEqual(["Cookie preferences", "Sign out"]);
  });

  it("omits cookie preferences when there is no decided production choice", () => {
    expect(menu().map((item) => item.label)).toEqual(["Sign out"]);
    expect(
      menu({ cookiePreferencesAvailable: true }).map((item) => item.label),
    ).toEqual(["Sign out"]);
    expect(
      menu({ cookiePreferencesDecided: true }).map((item) => item.label),
    ).toEqual(["Sign out"]);
  });

  it("closes mobile navigation before opening cookie preferences", () => {
    const onNavigate = vi.fn();
    const openCookiePreferences = vi.fn();
    const items = menu({
      cookiePreferencesAvailable: true,
      cookiePreferencesDecided: true,
      onNavigate,
      openCookiePreferences,
    });

    items.find((item) => item.label === "Cookie preferences")?.onSelect();

    expect(onNavigate).toHaveBeenCalledOnce();
    expect(openCookiePreferences).toHaveBeenCalledOnce();
    expect(onNavigate.mock.invocationCallOrder[0]).toBeLessThan(
      openCookiePreferences.mock.invocationCallOrder[0] ?? 0,
    );
  });
});
