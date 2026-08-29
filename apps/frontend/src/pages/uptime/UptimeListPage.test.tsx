import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";

import type { Monitor } from "../../api/types";
import {
  MonitorRowContent,
  monitorFrequencyLabel,
  monitorHost,
  monitorResponseTimeLabel,
  uptimeListHeaders,
} from "./UptimeListPage";

const monitor: Monitor = {
  body: null,
  bodyCondition: null,
  bodyConditionPath: null,
  bodyExpectedValue: null,
  channelIds: ["channel_email", "channel_push"],
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
  recentChecks: [
    {
      checkedAt: "2026-08-19T09:51:00.000Z",
      id: "check_1",
      status: "PASSED",
    },
    {
      checkedAt: "2026-08-19T09:56:00.000Z",
      id: "check_2",
      status: "FAILED",
    },
    {
      checkedAt: "2026-08-19T10:01:00.000Z",
      id: "check_3",
      status: "PASSED",
    },
  ],
  status: "UP",
  timeoutSeconds: 10,
  updatedAt: "2026-08-19T10:00:00.000Z",
  url: "https://user:secret@shop.example.com:8443/health?private=value#status",
};

describe("uptime monitor list", () => {
  it("keeps the required column order", () => {
    expect(uptimeListHeaders).toEqual([
      "Status",
      "Monitor",
      "Every",
      "Response",
      "Last 20 checks",
    ]);
  });

  it("renders monitor identity, status, cadence, response, and compact history", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <MonitorRowContent
          monitor={monitor}
          timezone="Europe/Madrid"
          workspaceId="ws_1"
        />
      </MemoryRouter>,
    );
    expect(html).toContain("/w/ws_1/uptime/monitor_1");
    expect(html).toContain("Storefront home");
    expect(html).toContain("shop.example.com:8443");
    expect(html).not.toContain("user:secret");
    expect(html).not.toContain("private=value");
    expect(html).toContain("Up");
    expect(html).toContain("Checking");
    expect(html).toContain("5 min");
    expect(html).toContain("Next ");
    expect(html).toContain("184 ms");
    expect(html).not.toContain("Automatic");
    expect(html).toContain("2/3 passed");
    expect(html).toContain("bg-ok-600");
    expect(html).toContain("bg-danger-600");
    expect(html).toContain("h-[18px]");
    expect(html).toContain(
      'aria-label="Last 20 checks for Storefront home: 2/3 passed; newest on the right"',
    );
    expect(html).toContain("title=\"Passed ·");
    expect(html).toContain("title=\"Failed ·");
    expect(html).toContain("/w/ws_1/incidents/incident_1");
    expect(html).toContain("Incident");
  });

  it("shows an explicit first-check state without inventing response data", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <MonitorRowContent
          monitor={{
            ...monitor,
            channelIds: [],
            checking: false,
            lastCheckAt: null,
            lastResponseTimeMs: null,
            openIncidentId: null,
            recentChecks: [],
            status: "UNKNOWN",
          }}
          timezone="Europe/Madrid"
          workspaceId="ws_1"
        />
      </MemoryRouter>,
    );
    expect(html).toContain("Unknown");
    expect(html).toContain("Waiting for first check");
    expect(html).toContain("No checks yet");
    expect(html).toContain(">—<");
    expect(html).not.toContain("/incidents/");
  });

  it("distinguishes a failed response from a monitor that has never checked", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <MonitorRowContent
          monitor={{
            ...monitor,
            checking: false,
            lastResponseTimeMs: null,
            openIncidentId: null,
            status: "DOWN",
          }}
          timezone="Europe/Madrid"
          workspaceId="ws_1"
        />
      </MemoryRouter>,
    );
    expect(html).toContain("Down");
    expect(html).toContain("No response");
    expect(html).not.toContain("/incidents/");
    expect(html).not.toContain("Waiting for first check");
  });

  it("keeps a healthy status concise when there is no incident", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <MonitorRowContent
          monitor={{
            ...monitor,
            checking: false,
            openIncidentId: null,
            status: "UP",
          }}
          timezone="Europe/Madrid"
          workspaceId="ws_1"
        />
      </MemoryRouter>,
    );
    expect(html).toContain("Up");
    expect(html).not.toContain("/incidents/");
    expect(html).not.toContain("Incident");
  });

  it("uses safe host, cadence, and response labels", () => {
    expect(
      monitorHost("https://user:secret@example.com:8443/path?token=private#hash"),
    ).toBe("example.com:8443");
    expect(monitorHost("not a url")).toBe("Unknown host");
    expect(monitorHost("javascript:alert(1)")).toBe("Unknown host");
    expect(monitorFrequencyLabel(300)).toBe("5 min");
    expect(monitorFrequencyLabel(3_600)).toBe("1 h");
    expect(monitorFrequencyLabel(86_400)).toBe("24 h");
    expect(monitorFrequencyLabel(0)).toBe("—");
    expect(monitorResponseTimeLabel(null)).toBe("No response");
    expect(monitorResponseTimeLabel(0)).toBe("0 ms");
  });
});
