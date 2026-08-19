import { afterEach, describe, expect, it, vi } from "vitest";

import type { Monitor, MonitorInput } from "./types";
import {
  checksPath,
  createMonitor,
  deleteMonitor,
  getMonitor,
  getStats,
  listChecks,
  listMonitors,
  monitorPath,
  testRequest,
  updateMonitor,
} from "./uptime";

const input: MonitorInput = {
  bodyCondition: null,
  bodyConditionPath: null,
  bodyExpectedValue: null,
  channelIds: [],
  expectedStatus: 200,
  frequencySeconds: 300,
  maxRetries: 1,
  method: "GET",
  name: "Homepage",
  notifyOnRecovery: true,
  timeoutSeconds: 10,
  url: "https://example.com/health",
};

const monitor: Monitor = {
  ...input,
  body: null,
  bodyCondition: null,
  bodyConditionPath: null,
  bodyExpectedValue: null,
  checking: false,
  createdAt: "2026-08-19T10:00:00.000Z",
  createdBy: null,
  headers: [],
  headersMasked: false,
  id: "monitor_1",
  lastCheckAt: null,
  lastResponseTimeMs: null,
  nextCheckAt: "2026-08-19T10:05:00.000Z",
  openIncidentId: null,
  status: "UNKNOWN",
  updatedAt: "2026-08-19T10:00:00.000Z",
};

function response(data: unknown, nextCursor?: string | null): Response {
  return new Response(JSON.stringify({ data, nextCursor }), {
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("uptime API", () => {
  it("encodes monitor and paginated check paths", () => {
    expect(monitorPath("ws/one", "monitor two")).toBe(
      "/api/workspaces/ws%2Fone/uptime-monitors/monitor%20two",
    );
    expect(checksPath("ws_1", "monitor_1", { cursor: "next+/=", limit: 25 })).toBe(
      "/api/workspaces/ws_1/uptime-monitors/monitor_1/checks?limit=25&cursor=next%2B%2F%3D",
    );
  });

  it("exposes every monitor, test-request, checks, and stats operation", async () => {
    const fetchMock = vi.fn(async (request: RequestInfo | URL, options?: RequestInit) => {
      const path = String(request);
      if (options?.method === "DELETE") return new Response(null, { status: 204 });
      if (path.endsWith("/checks?limit=50")) return response([], null);
      if (path.endsWith("/stats")) {
        return response({
          avgResponseTimeMs24h: null,
          series: [],
          uptime24h: null,
          uptime30d: null,
          uptime7d: null,
        });
      }
      if (path.endsWith("/test-request")) {
        return response({
          conditions: [],
          failureReason: null,
          httpStatus: 200,
          passed: true,
          responseExcerpt: null,
          responseTimeMs: 42,
        });
      }
      if (path.endsWith("/uptime-monitors") && (!options?.method || options.method === "GET")) {
        return response([monitor]);
      }
      return response(monitor);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(listMonitors("ws_1")).resolves.toEqual([monitor]);
    await expect(getMonitor("ws_1", "monitor_1")).resolves.toEqual(monitor);
    await expect(createMonitor("ws_1", input)).resolves.toEqual(monitor);
    await expect(updateMonitor("ws_1", "monitor_1", { name: "Updated" })).resolves.toEqual(monitor);
    await expect(deleteMonitor("ws_1", "monitor_1")).resolves.toBeUndefined();
    await expect(testRequest("ws_1", input)).resolves.toMatchObject({ passed: true });
    await expect(listChecks("ws_1", "monitor_1")).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    await expect(getStats("ws_1", "monitor_1")).resolves.toMatchObject({ series: [] });

    expect(fetchMock.mock.calls.map(([, options]) => options?.method ?? "GET")).toEqual([
      "GET",
      "GET",
      "POST",
      "PATCH",
      "DELETE",
      "POST",
      "GET",
      "GET",
    ]);
  });
});
