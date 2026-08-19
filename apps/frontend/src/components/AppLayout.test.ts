import { describe, expect, it } from "vitest";

import { navigationItems, visibleNavigationItems } from "./Sidebar";

describe("workspace navigation", () => {
  it("keeps the required navigation order", () => {
    expect(navigationItems.map((item) => item.label)).toEqual([
      "Overview",
      "Browser Tests",
      "Uptime",
      "Incidents",
      "Notifications",
      "Secrets",
      "Members",
      "Usage & Billing",
      "Workspace Settings",
    ]);
  });

  it("hides billing when the role cannot view it", () => {
    const memberItems = visibleNavigationItems(() => false);
    expect(memberItems.map((item) => item.label)).not.toContain("Usage & Billing");
    expect(memberItems).toHaveLength(navigationItems.length - 1);
  });

  it("shows billing when the role can view it", () => {
    expect(visibleNavigationItems(() => true)).toEqual(navigationItems);
  });
});
