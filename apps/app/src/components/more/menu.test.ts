import { describe, expect, it } from "@jest/globals";

import { moreMenuItems, visibleMoreItems } from "./menu";

describe("more menu", () => {
  it("keeps the sidebar order", () => {
    expect(moreMenuItems.map((item) => item.label)).toEqual([
      "Notifications",
      "Secrets",
      "Members",
      "Plan & Usage",
      "Workspace Settings",
    ]);
  });

  it("hides billing when the role cannot view it", () => {
    const memberItems = visibleMoreItems(() => false);
    expect(memberItems.map((item) => item.label)).not.toContain("Plan & Usage");
    expect(memberItems).toHaveLength(moreMenuItems.length - 1);
  });

  it("shows billing when the role can view it", () => {
    expect(visibleMoreItems(() => true)).toEqual(moreMenuItems);
    expect(visibleMoreItems((action) => action === "billing.view").map((item) => item.path)).toContain(
      "billing",
    );
  });
});
