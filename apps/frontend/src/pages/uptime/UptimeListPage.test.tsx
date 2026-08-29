import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";

import type { Monitor } from "../../api/types";
import {
  MonitorRowContent,
  monitorAlertChannelsLabel,
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
      "Monitor",
      "History",
      "Next check",
      "Alerts",
    ]);
  });

  it("renders monitor identity, check history, and alert coverage", () => {
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
    expect(html).toContain("Every 5 min");
    expect(html).toContain("184 ms");
    expect(html).not.toContain("Automatic");
    expect(html).toContain("2/3 passed");
    expect(html).toContain("bg-ok-600");
    expect(html).toContain("bg-danger-600");
    expect(html).toContain("aria-label=\"Passed ·");
    expect(html).toContain("aria-label=\"Failed ·");
    expect(html).toContain("/w/ws_1/incidents/incident_1");
    expect(html).toContain("Open incident");
    expect(html).toContain("2 alert channels");
  });

  it("shows an explicit first-check and no-incident state", () => {
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
    expect(html).toContain("No open incident");
    expect(html).toContain("No alert channels");
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
    expect(html).toContain("No open incident");
    expect(html).not.toContain("All clear");
    expect(html).not.toContain("Waiting for first check");
  });

  it("shows All clear only for a healthy monitor without an incident", () => {
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
    expect(html).toContain("All clear");
    expect(html).not.toContain("No open incident");
  });

  it("uses safe host, response, and channel labels", () => {
    expect(
      monitorHost("https://user:secret@example.com:8443/path?token=private#hash"),
    ).toBe("example.com:8443");
    expect(monitorHost("not a url")).toBe("Unknown host");
    expect(monitorHost("javascript:alert(1)")).toBe("Unknown host");
    expect(monitorAlertChannelsLabel(0)).toBe("No alert channels");
    expect(monitorAlertChannelsLabel(1)).toBe("1 alert channel");
    expect(monitorAlertChannelsLabel(3)).toBe("3 alert channels");
    expect(monitorResponseTimeLabel(null)).toBe("No response");
    expect(monitorResponseTimeLabel(0)).toBe("0 ms");
  });
});
