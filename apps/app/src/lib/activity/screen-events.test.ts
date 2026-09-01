import { describe, expect, it } from "@jest/globals";

import { appOpenedEvent, screenPattern, visitEventFor } from "./screen-events";

const meta = { appVersion: "1.2.0" };

describe("screenPattern", () => {
  it("drops route groups and keeps dynamic segments", () => {
    expect(screenPattern(["w", "[wsId]", "(tabs)", "(tests)", "tests", "[testId]"])).toBe("/w/[wsId]/tests/[testId]");
    expect(screenPattern(["(auth)", "sign-in"])).toBe("/sign-in");
    expect(screenPattern([])).toBe("/");
  });
});

describe("visitEventFor", () => {
  it("maps resource screens to typed visits", () => {
    expect(
      visitEventFor(["w", "[wsId]", "(tabs)", "(tests)", "tests", "[testId]"], { wsId: "ws_1", testId: "bt_9" }, meta),
    ).toEqual({
      type: "browser_test.viewed",
      workspaceId: "ws_1",
      resourceId: "bt_9",
      properties: { screen: "/w/[wsId]/tests/[testId]", appVersion: "1.2.0", platform: "ios" },
    });
    expect(
      visitEventFor(["w", "[wsId]", "(tabs)", "(tests)", "tests", "[testId]", "edit"], { wsId: "ws_1", testId: "bt_9" }, meta)
        ?.type,
    ).toBe("browser_test.viewed");
    expect(
      visitEventFor(["w", "[wsId]", "(tabs)", "(tests)", "runs", "[runId]"], { wsId: "ws_1", runId: "run_2" }, meta),
    ).toMatchObject({ type: "run.viewed", resourceId: "run_2" });
    expect(
      visitEventFor(["w", "[wsId]", "(tabs)", "(uptime)", "uptime", "[monitorId]"], { wsId: "ws_1", monitorId: "mon_3" }, meta),
    ).toMatchObject({ type: "uptime_monitor.viewed", resourceId: "mon_3" });
    expect(
      visitEventFor(
        ["w", "[wsId]", "(tabs)", "(incidents)", "incidents", "[incidentId]"],
        { wsId: "ws_1", incidentId: "inc_4" },
        meta,
      ),
    ).toMatchObject({ type: "incident.viewed", resourceId: "inc_4" });
  });

  it("maps other authenticated screens to app.screen_viewed", () => {
    expect(visitEventFor(["w", "[wsId]", "(tabs)", "(overview)", "overview"], { wsId: "ws_1" }, meta)).toEqual({
      type: "app.screen_viewed",
      workspaceId: "ws_1",
      properties: { screen: "/w/[wsId]/overview", appVersion: "1.2.0", platform: "ios" },
    });
    expect(visitEventFor(["access-unavailable"], {}, meta)).toBeNull();
  });

  it("ignores public screens", () => {
    for (const segments of [
      ["(auth)", "sign-in"],
      ["(auth)", "forgot-password"],
      ["(auth)", "reset-password"],
      ["privacy"],
      ["terms"],
      ["invitations", "[token]"],
      ["invitations", "accept"],
      ["access-unavailable"],
      [],
    ]) {
      expect(visitEventFor(segments, {}, meta)).toBeNull();
    }
  });
});

describe("appOpenedEvent", () => {
  it("carries version and platform", () => {
    expect(appOpenedEvent(meta)).toEqual({ type: "app.opened", properties: { appVersion: "1.2.0", platform: "ios" } });
  });
});
