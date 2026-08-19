import { afterEach, describe, expect, it, vi } from "vitest";

import { getIncident, incidentsPath, listIncidents } from "./incidents";

afterEach(() => vi.unstubAllGlobals());

describe("incidents API", () => {
  it("encodes filters, dates, and opaque cursors", () => {
    expect(
      incidentsPath(
        "ws/one",
        { from: "2026-08-01", status: "open", to: "2026-08-19", type: "uptime" },
        "next+/=",
        100,
      ),
    ).toBe(
      "/api/workspaces/ws%2Fone/incidents?limit=100&status=open&type=uptime&from=2026-08-01&to=2026-08-19&cursor=next%2B%2F%3D",
    );
  });

  it("unwraps list pages and incident detail", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [], nextCursor: "next" }), {
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: "incident_1" } }), {
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(listIncidents("ws_1", { type: "uptime" })).resolves.toEqual({
      items: [],
      nextCursor: "next",
    });
    await expect(getIncident("ws_1", "incident_1")).resolves.toMatchObject({
      id: "incident_1",
    });
  });
});
