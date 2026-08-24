import { AUDIT_ACTIONS } from "../audit/actions";
import {
  ACTIVITY_EVENTS,
  ACTIVITY_EVENT_SPECS,
  AUDIT_TO_ACTIVITY,
  CLIENT_ACTIVITY_EVENT_TYPES,
  activityEventTypesByVolume,
  isActivityEventType,
} from "./catalog";

describe("activity catalog", () => {
  it("names every type as <subject>.<past_tense_verb> in snake_case", () => {
    for (const type of Object.values(ACTIVITY_EVENTS)) {
      expect(type).toMatch(/^[a-z][a-z_]*\.[a-z][a-z_]*$/u);
    }
  });

  it("declares a spec for every type and nothing else", () => {
    expect(Object.keys(ACTIVITY_EVENT_SPECS).sort()).toEqual(
      Object.values(ACTIVITY_EVENTS).sort(),
    );
  });

  it("maps every audit action to an activity type", () => {
    expect(Object.keys(AUDIT_TO_ACTIVITY).sort()).toEqual(
      Object.values(AUDIT_ACTIONS).sort(),
    );
    for (const type of Object.values(AUDIT_TO_ACTIVITY)) {
      expect(isActivityEventType(type)).toBe(true);
    }
    expect(AUDIT_TO_ACTIVITY["security.encryption_rotated"]).toBe("security.encryption_rotated");
    expect(AUDIT_TO_ACTIVITY["alerts.credit_adjusted"]).toBe("alerts.credit_adjusted");
    expect(AUDIT_TO_ACTIVITY["test.created"]).toBe("browser_test.created");
    expect(AUDIT_TO_ACTIVITY["monitor.created"]).toBe("uptime_monitor.created");
    expect(AUDIT_TO_ACTIVITY["test.run_manual"]).toBe("browser_test.run_requested");
  });

  it("names a resource type for every bridged type, since audits forward resourceId", () => {
    for (const type of new Set(Object.values(AUDIT_TO_ACTIVITY))) {
      expect(ACTIVITY_EVENT_SPECS[type].resourceType, type).toEqual(
        expect.any(String),
      );
    }
    expect(ACTIVITY_EVENT_SPECS["alerts.settings_updated"].resourceType).toBe(
      "alert_settings",
    );
    expect(ACTIVITY_EVENT_SPECS["security.encryption_rotated"].resourceType).toBe(
      "workspace_encryption",
    );
    expect(ACTIVITY_EVENT_SPECS["billing.subscription_updated"].resourceType).toBe(
      "subscription",
    );
    expect(ACTIVITY_EVENT_SPECS["billing.grant_issued"].resourceType).toBe(
      "subscription_grant",
    );
    expect(ACTIVITY_EVENT_SPECS["billing.grant_redeemed"].resourceType).toBe(
      "subscription_grant",
    );
    expect(ACTIVITY_EVENT_SPECS["alerts.credit_topup"].resourceType).toBe(
      "alert_credit",
    );
    expect(ACTIVITY_EVENT_SPECS["alerts.credit_adjusted"].resourceType).toBe(
      "alert_credit",
    );
  });

  it("never lets a client send a type that the server emits", () => {
    const bridged = new Set(Object.values(AUDIT_TO_ACTIVITY));
    for (const type of CLIENT_ACTIVITY_EVENT_TYPES) {
      expect(bridged.has(type)).toBe(false);
      expect(ACTIVITY_EVENT_SPECS[type].client).toBe(true);
    }
    expect(CLIENT_ACTIVITY_EVENT_TYPES).toEqual(
      expect.arrayContaining([
        "web.page_viewed",
        "app.screen_viewed",
        "app.opened",
        "browser_test.viewed",
        "run.viewed",
        "uptime_monitor.viewed",
        "incident.viewed",
      ]),
    );
    expect(CLIENT_ACTIVITY_EVENT_TYPES).toHaveLength(7);
  });

  it("classifies volume so retention can purge visits first", () => {
    const high = activityEventTypesByVolume("high");
    expect(high).toEqual(
      expect.arrayContaining([
        "web.page_viewed",
        "app.screen_viewed",
        "browser_test.run_passed",
        "alert.sent",
        "api_key.used",
      ]),
    );
    expect(high).not.toContain("browser_test.created");
    expect(activityEventTypesByVolume("normal")).toContain("user.logged_in");
  });

  it("recognises catalog types and rejects strangers", () => {
    expect(isActivityEventType("user.logged_in")).toBe(true);
    expect(isActivityEventType("toString")).toBe(false);
    expect(isActivityEventType("browser_test.deleted_everything")).toBe(false);
  });

  it("requires a workspace for workspace-scoped resources", () => {
    expect(ACTIVITY_EVENT_SPECS["browser_test.viewed"]).toEqual({
      scope: "workspace",
      resourceType: "browser_test",
      client: true,
      volume: "high",
    });
    expect(ACTIVITY_EVENT_SPECS["user.logged_in"].scope).toBe("user");
    expect(ACTIVITY_EVENT_SPECS["web.page_viewed"].scope).toBe("any");
  });
});
