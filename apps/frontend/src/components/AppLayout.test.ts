import { describe, expect, it } from "vitest";

import type { AlertsOverview } from "../api/types";
import { alertCreditBanner } from "./AppLayout";
import { navigationItems, visibleNavigationItems } from "./Sidebar";

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

describe("workspace navigation", () => {
  it("keeps the required navigation order", () => {
    expect(navigationItems.map((item) => item.label)).toEqual([
      "Overview",
      "Browser Tests",
      "Uptime",
      "Incidents",
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
