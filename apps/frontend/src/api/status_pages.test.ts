import { afterEach, describe, expect, it, vi } from "vitest";

import type { StatusPage, StatusPageDetail, StatusPageItem } from "./types";
import {
  addStatusPageItem,
  createStatusPage,
  deleteStatusPage,
  fetchStatusPagePreview,
  getStatusPage,
  listStatusPages,
  publishStatusPage,
  removeStatusPageItem,
  reorderStatusPageItems,
  statusPagePath,
  unpublishStatusPage,
  updateStatusPage,
  updateStatusPageItem,
} from "./status_pages";
import {
  deleteIncidentUpdate,
  listIncidentUpdates,
  postIncidentUpdate,
} from "./incidents";

const page: StatusPage = {
  accentColor: "#22c55e",
  createdAt: "2026-08-30T10:00:00.000Z",
  customDomain: null,
  description: null,
  id: "sp_1",
  publishedAt: null,
  slug: "acme",
  theme: "SYSTEM",
  title: "Acme Status",
  updatedAt: "2026-08-30T10:00:00.000Z",
};

const item: StatusPageItem = {
  displayName: "Public API",
  groupName: null,
  id: "spi_1",
  position: 0,
  resourceId: "mon_1",
  resourceType: "UPTIME_MONITOR",
};

const detail: StatusPageDetail = { ...page, items: [item] };

function response(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("status pages API", () => {
  it("encodes paths", () => {
    expect(statusPagePath("ws/one", "page two")).toBe(
      "/api/workspaces/ws%2Fone/status-pages/page%20two",
    );
  });

  it("exposes page, item, preview and incident-update operations", async () => {
    const fetchMock = vi.fn(async (request: RequestInfo | URL, options?: RequestInit) => {
      const path = String(request);
      const method = options?.method ?? "GET";
      if (path.endsWith("/preview")) {
        return new Response("<!doctype html><html><body>Preview</body></html>", {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      if (path.endsWith("/items/order")) return response({ ok: true });
      if (path.includes("/items/") && method === "DELETE") {
        return response({ ok: true });
      }
      if (path.includes("/items")) return response(item);
      if (path.includes("/updates")) {
        if (method === "DELETE") return response({ ok: true });
        if (method === "POST") {
          return response({
            createdAt: "2026-08-30T10:00:00.000Z",
            createdBy: "usr_1",
            id: "iu_1",
            message: "We are investigating.",
          });
        }
        return response([]);
      }
      if (path.endsWith("/status-pages") && method === "GET") {
        return response([page]);
      }
      if (method === "DELETE") return response({ ok: true });
      if (path.endsWith("/sp_1") && method === "GET") return response(detail);
      return response(page);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(listStatusPages("ws_1")).resolves.toEqual([page]);
    await expect(
      createStatusPage("ws_1", { slug: "acme", title: "Acme Status" }),
    ).resolves.toEqual(page);
    await expect(getStatusPage("ws_1", "sp_1")).resolves.toEqual(detail);
    await expect(
      updateStatusPage("ws_1", "sp_1", { title: "Renamed" }),
    ).resolves.toEqual(page);
    await expect(publishStatusPage("ws_1", "sp_1")).resolves.toEqual(page);
    await expect(unpublishStatusPage("ws_1", "sp_1")).resolves.toEqual(page);
    await expect(deleteStatusPage("ws_1", "sp_1")).resolves.toBeUndefined();
    await expect(
      addStatusPageItem("ws_1", "sp_1", {
        displayName: "Public API",
        resourceId: "mon_1",
        resourceType: "UPTIME_MONITOR",
      }),
    ).resolves.toEqual(item);
    await expect(
      updateStatusPageItem("ws_1", "sp_1", "spi_1", { displayName: "API" }),
    ).resolves.toEqual(item);
    await expect(
      removeStatusPageItem("ws_1", "sp_1", "spi_1"),
    ).resolves.toBeUndefined();
    await expect(
      reorderStatusPageItems("ws_1", "sp_1", ["spi_1"]),
    ).resolves.toBeUndefined();
    await expect(fetchStatusPagePreview("ws_1", "sp_1")).resolves.toContain(
      "Preview",
    );

    await expect(listIncidentUpdates("ws_1", "inc_1")).resolves.toEqual([]);
    await expect(
      postIncidentUpdate("ws_1", "inc_1", "We are investigating."),
    ).resolves.toMatchObject({ id: "iu_1" });
    await expect(
      deleteIncidentUpdate("ws_1", "inc_1", "iu_1"),
    ).resolves.toBeUndefined();

    const calls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(calls.some((url) => url.includes("/status-pages/sp_1/publish"))).toBe(true);
    expect(calls.some((url) => url.includes("/status-pages/sp_1/unpublish"))).toBe(true);
    expect(
      calls.some((url) => url.includes("/incidents/inc_1/updates/iu_1")),
    ).toBe(true);
  });
});
