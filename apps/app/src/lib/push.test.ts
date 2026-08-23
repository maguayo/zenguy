import { describe, expect, it } from "@jest/globals";

import { isExpoPushToken, notificationPath, pushLinkToPath, resolvePermission } from "./push";

describe("push helpers", () => {
  it("recognises Expo push tokens only", () => {
    expect(isExpoPushToken("ExponentPushToken[abc123]")).toBe(true);
    expect(isExpoPushToken("ExpoPushToken[xyz]")).toBe(true);
    expect(isExpoPushToken("abc123")).toBe(false);
    expect(isExpoPushToken("ExponentPushToken[]")).toBe(false);
    expect(isExpoPushToken(undefined)).toBe(false);
  });

  it("maps verified Universal Links to in-app paths and rejects everything else", () => {
    expect(pushLinkToPath("https://app.zenguy.com/w/ws_1/incidents/inc_1")).toBe("/w/ws_1/incidents/inc_1");
    expect(pushLinkToPath("https://app.zenguy.com/w/ws_1/alerts")).toBe("/w/ws_1/alerts");
    expect(pushLinkToPath("https://app.zenguy.com/w/ws_1/overview/")).toBe("/w/ws_1/overview");
    expect(pushLinkToPath("https://evil.example/w/ws_1/incidents/inc_1")).toBeNull();
    expect(pushLinkToPath("zenguy://settings")).toBeNull();
    expect(pushLinkToPath("zenguy://w/ws 1/incidents/x")).toBeNull();
    expect(pushLinkToPath(42)).toBeNull();
    expect(notificationPath({ url: "https://app.zenguy.com/w/ws_1/incidents/inc_1", incidentId: "inc_1" })).toBe(
      "/w/ws_1/incidents/inc_1",
    );
    expect(notificationPath(null)).toBeNull();
  });

  it("derives the permission state from device, configuration and iOS status", () => {
    expect(resolvePermission({ canAskAgain: true, isDevice: false, projectId: "p", status: "granted" })).toEqual({
      permission: "unavailable",
      reason: "simulator",
    });
    expect(resolvePermission({ canAskAgain: true, isDevice: true, projectId: null, status: "granted" })).toEqual({
      permission: "unavailable",
      reason: "not-configured",
    });
    expect(resolvePermission({ canAskAgain: true, isDevice: true, projectId: "p", status: "granted" })).toEqual({
      permission: "granted",
      reason: null,
    });
    expect(resolvePermission({ canAskAgain: false, isDevice: true, projectId: "p", status: "denied" })).toEqual({
      permission: "denied",
      reason: null,
    });
    expect(resolvePermission({ canAskAgain: true, isDevice: true, projectId: "p", status: "undetermined" })).toEqual({
      permission: "undetermined",
      reason: null,
    });
  });
});
