import { describe, expect, it } from "vitest";

import {
  createWorkspaceSchema,
  defaultWorkspaceName,
  filterTimezones,
} from "./CreateWorkspace";

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
});
