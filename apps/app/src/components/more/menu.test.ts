import { describe, expect, it } from "@jest/globals";

import { moreMenuItems, visibleMoreItems } from "./menu";

describe("more menu", () => {
  it("keeps the sidebar order", () => {
    expect(moreMenuItems.map((item) => item.label)).toEqual([
      "Notifications",
      "Secrets",
      "Members",
      "AI data sharing",
      "Workspace Settings",
    ]);
  });

  it("limits workspace privacy decisions to roles with settings permission", () => {
    expect(visibleMoreItems(() => false).map((item) => item.label)).not.toContain(
      "AI data sharing",
    );
    expect(visibleMoreItems(() => true)).toEqual(moreMenuItems);
  });
});
