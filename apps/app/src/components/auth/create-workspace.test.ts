import { describe, expect, it } from "@jest/globals";

import type { Workspace } from "@/api/types";
import { filterTimezones } from "@/lib/timezones";
import {
  backWorkspace,
  createWorkspaceSchema,
  defaultTimezone,
  defaultWorkspaceName,
} from "./create-workspace";

const workspace = (id: string): Workspace => ({
  createdAt: "2026-01-01T00:00:00.000Z",
  id,
  name: id,
  role: "OWNER",
  slug: id,
  subscriptionStatus: "ACTIVE",
  timezone: "UTC",
});

describe("workspace onboarding", () => {
  it("prefills the workspace name from the user's first name", () => {
    expect(defaultWorkspaceName("Ada Lovelace")).toBe("Ada's Workspace");
    expect(defaultWorkspaceName("  ")).toBe("My Workspace");
  });

  it("filters timezone choices without case sensitivity", () => {
    expect(
      filterTimezones(["Europe/Madrid", "America/Madrid", "Asia/Tokyo"], "mAdRiD"),
    ).toEqual(["Europe/Madrid", "America/Madrid"]);
  });

  it("enforces the API workspace-name limits", () => {
    expect(
      createWorkspaceSchema.safeParse({ name: "Acme", timezone: "Europe/Madrid" }).success,
    ).toBe(true);
    expect(createWorkspaceSchema.safeParse({ name: "", timezone: "" }).success).toBe(false);
    expect(
      createWorkspaceSchema.safeParse({ name: "x".repeat(81), timezone: "UTC" }).success,
    ).toBe(false);
  });

  it("defaults to the device timezone only when the API knows it", () => {
    expect(defaultTimezone(["UTC", "Europe/Madrid"], "Europe/Madrid")).toBe("Europe/Madrid");
    expect(defaultTimezone(["UTC", "Europe/Madrid"], "Mars/Olympus")).toBe("UTC");
    expect(defaultTimezone([], "Europe/Madrid")).toBe("UTC");
  });

  it("points the back link at the last used workspace, else the first", () => {
    const list = [workspace("ws_1"), workspace("ws_2")];
    expect(backWorkspace(list, "ws_2")?.id).toBe("ws_2");
    expect(backWorkspace(list, "ws_9")?.id).toBe("ws_1");
    expect(backWorkspace(list, null)?.id).toBe("ws_1");
    expect(backWorkspace([], null)).toBeUndefined();
    expect(backWorkspace(undefined, "ws_1")).toBeUndefined();
  });
});
