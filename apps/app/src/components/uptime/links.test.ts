import { describe, expect, it } from "@jest/globals";

import {
  editMonitorHref,
  incidentHref,
  monitorHref,
  newMonitorHref,
  uptimeHref,
} from "./links";

describe("uptime links", () => {
  it("mirror the web app's URLs", () => {
    expect(uptimeHref("ws_1")).toBe("/w/ws_1/uptime");
    expect(newMonitorHref("ws_1")).toBe("/w/ws_1/uptime/new");
    expect(monitorHref("ws_1", "monitor_1")).toBe("/w/ws_1/uptime/monitor_1");
    expect(editMonitorHref("ws_1", "monitor_1")).toBe("/w/ws_1/uptime/monitor_1/edit");
    expect(incidentHref("ws_1", "incident_1")).toBe("/w/ws_1/incidents/incident_1");
  });
});
