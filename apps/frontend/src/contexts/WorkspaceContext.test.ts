import { describe, expect, it } from "vitest";

import type { Workspace } from "../api/types";
import { resolveWorkspace } from "./WorkspaceContext";

const workspace: Workspace = {
  createdAt: "2026-08-19T10:00:00.000Z",
  id: "ws_1",
  name: "Acme",
  role: "OWNER",
  slug: "acme",
  subscriptionStatus: "ACTIVE",
  timezone: "Europe/Madrid",
};

describe("workspace resolution", () => {
  it("resolves only a workspace present in the user's list", () => {
    expect(resolveWorkspace([workspace], "ws_1")).toEqual(workspace);
    expect(resolveWorkspace([workspace], "ws_other")).toBeUndefined();
    expect(resolveWorkspace([workspace], undefined)).toBeUndefined();
  });
});
