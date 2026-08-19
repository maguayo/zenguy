import { describe, expect, it } from "vitest";

import { exportTestsPath, runsPath } from "./tests";

describe("browser-test API paths", () => {
  it("encodes identifiers and requests 100 run rows by default", () => {
    expect(runsPath("ws/one", "test two")).toBe(
      "/api/workspaces/ws%2Fone/browser-tests/test%20two/runs?limit=100",
    );
  });

  it("builds the export path with the requested format", () => {
    expect(exportTestsPath("ws/one", "json")).toBe(
      "/api/workspaces/ws%2Fone/browser-tests/export?format=json",
    );
    expect(exportTestsPath("ws_1", "yaml")).toBe(
      "/api/workspaces/ws_1/browser-tests/export?format=yaml",
    );
  });

  it("preserves opaque cursors and status filters", () => {
    const path = runsPath("ws_1", "test_1", {
      cursor: "next+/=",
      status: "SYSTEM_ERROR",
    });
    expect(path).toContain("cursor=next%2B%2F%3D");
    expect(path).toContain("status=SYSTEM_ERROR");
  });
});
