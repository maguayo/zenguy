import { describe, expect, it } from "@jest/globals";

import type { Workspace } from "@/api/types";
import { hasMobileAccess, pickMobileWorkspace, resolveWorkspace } from "./WorkspaceContext";

const workspace = (
  id: string,
  subscriptionStatus: Workspace["subscriptionStatus"] = "ACTIVE",
): Workspace => ({
  createdAt: "2026-01-01T00:00:00.000Z",
  id,
  name: id,
  role: "OWNER",
  slug: id,
  subscriptionStatus,
  timezone: "UTC",
});

describe("workspace resolution", () => {
  it("finds the workspace by id", () => {
    const list = [workspace("ws_1"), workspace("ws_2")];
    expect(resolveWorkspace(list, "ws_2")?.id).toBe("ws_2");
    expect(resolveWorkspace(list, "ws_9")).toBeUndefined();
    expect(resolveWorkspace(list, undefined)).toBeUndefined();
  });

  it("allows mobile access only for active and past-due workspaces", () => {
    expect(hasMobileAccess("NONE")).toBe(false);
    expect(hasMobileAccess("CANCELED")).toBe(false);
    expect(hasMobileAccess("ACTIVE")).toBe(true);
    expect(hasMobileAccess("PAST_DUE")).toBe(true);
  });

  it("uses the remembered workspace only when it still has mobile access", () => {
    const list = [
      workspace("ws_canceled", "CANCELED"),
      workspace("ws_active", "ACTIVE"),
      workspace("ws_past_due", "PAST_DUE"),
    ];

    expect(pickMobileWorkspace(list, "ws_past_due")?.id).toBe("ws_past_due");
    expect(pickMobileWorkspace(list, "ws_canceled")?.id).toBe("ws_active");
    expect(pickMobileWorkspace(list, "ws_missing")?.id).toBe("ws_active");
  });

  it("returns no workspace when the account has no existing mobile access", () => {
    const list = [workspace("ws_none", "NONE"), workspace("ws_canceled", "CANCELED")];
    expect(pickMobileWorkspace(list, "ws_canceled")).toBeUndefined();
  });
});
