import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";

import type { Monitor } from "../../api/types";
import { monitorHost, uptimeColumns } from "./UptimeListPage";

const monitor: Monitor = {
  body: null,
  bodyCondition: null,
  bodyConditionPath: null,
  bodyExpectedValue: null,
  channelIds: [],
  checking: true,
  createdAt: "2026-08-19T10:00:00.000Z",
  createdBy: null,
  expectedStatus: 200,
  frequencySeconds: 300,
  headers: [],
  headersMasked: false,
  id: "monitor_1",
  lastCheckAt: "2026-08-19T10:01:00.000Z",
  lastResponseTimeMs: 184,
  maxRetries: 1,
  method: "GET",
  name: "Storefront home",
  nextCheckAt: "2026-08-19T10:05:00.000Z",
  notifyOnRecovery: true,
  openIncidentId: "incident_1",
  status: "UP",
  timeoutSeconds: 10,
  updatedAt: "2026-08-19T10:00:00.000Z",
  url: "https://shop.example.com/health?private=value",
};

describe("uptime table", () => {
  it("keeps the required column order", () => {
    expect(uptimeColumns("ws_1").map((column) => column.key)).toEqual([
      "status",
      "name",
      "frequency",
      "lastCheck",
      "response",
      "incident",
      "actions",
    ]);
  });

  it("renders status, safe host, cadence, response, and incident", () => {
    const columns = uptimeColumns("ws_1");
    const html = renderToStaticMarkup(
      <MemoryRouter>
        {columns.slice(0, 6).map((column) => (
          <div key={column.key}>{column.render(monitor)}</div>
        ))}
      </MemoryRouter>,
    );
    expect(html).toContain("Up");
    expect(html).toContain("Checking");
    expect(html).toContain("shop.example.com");
    expect(html).not.toContain("private=value");
    expect(html).toContain("Every 5 min");
    expect(html).toContain("184 ms");
    expect(html).toContain("/w/ws_1/incidents/incident_1");
  });

  it("falls back safely when a host cannot be parsed", () => {
    expect(monitorHost("not a url")).toBe("not a url");
  });
});
