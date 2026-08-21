import { describe, expect, it } from "@jest/globals";

import type { Workspace } from "@/api/types";
import { requiresBillingSetup, resolveWorkspace } from "./WorkspaceContext";

const workspace = (id: string): Workspace => ({
  createdAt: "2026-01-01T00:00:00.000Z",
  id,
  name: id,
  role: "OWNER",
  slug: id,
  subscriptionStatus: "ACTIVE",
  timezone: "UTC",
});

describe("workspace resolution", () => {
  it("finds the workspace by id", () => {
    const list = [workspace("ws_1"), workspace("ws_2")];
    expect(resolveWorkspace(list, "ws_2")?.id).toBe("ws_2");
    expect(resolveWorkspace(list, "ws_9")).toBeUndefined();
    expect(resolveWorkspace(list, undefined)).toBeUndefined();
  });

  it("requires billing setup only for NONE and CANCELED", () => {
    expect(requiresBillingSetup("NONE")).toBe(true);
    expect(requiresBillingSetup("CANCELED")).toBe(true);
    expect(requiresBillingSetup("ACTIVE")).toBe(false);
    expect(requiresBillingSetup("PAST_DUE")).toBe(false);
  });
});
