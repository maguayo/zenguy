import { afterEach, describe, expect, it, vi } from "vitest";

import { exportTestsPath, listTests, runsPath, testsPath } from "./tests";

afterEach(() => {
  vi.unstubAllGlobals();
});

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
      limit: 20,
      status: "SYSTEM_ERROR",
    });
    expect(path).toContain("limit=20");
    expect(path).toContain("cursor=next%2B%2F%3D");
    expect(path).toContain("status=SYSTEM_ERROR");
  });

  it("encodes the browser-test page cursor", () => {
    expect(testsPath("ws/one", "next+/=")).toBe(
      "/api/workspaces/ws%2Fone/browser-tests?limit=100&cursor=next%2B%2F%3D",
    );
  });

  it("keeps the legacy list contract while following bounded pages", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: [{ id: "bt_two" }], nextCursor: "cursor-2" }),
          { headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: [{ id: "bt_one" }], nextCursor: null }),
          { headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(listTests("ws_1")).resolves.toEqual([
      { id: "bt_two" },
      { id: "bt_one" },
    ]);
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/workspaces/ws_1/browser-tests?limit=100",
      "/api/workspaces/ws_1/browser-tests?limit=100&cursor=cursor-2",
    ]);
  });
});
