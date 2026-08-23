import { readFileSync } from "node:fs";
import { ACTIVITY_EVENTS } from "../../domain/activity/catalog";

/** Explicit emission points (audited mutations are bridged by WriteAudit). */
const EXPLICIT_POINTS = {
  userRegistered: "../auth/register.ts",
  userEmailVerified: "../auth/verify_email.ts",
  userLoggedIn: "../auth/login.ts",
  userLoggedOut: "../auth/logout.ts",
  browserTestValidated: "../browser_tests/validate_draft.ts",
  browserTestImported: "../browser_tests/import_tests.ts",
  browserTestExported: "../../http/routes/browser_tests.ts",
  browserTestRunPassed: "../execution/attempt_lifecycle.ts",
  browserTestRunFailed: "../execution/attempt_lifecycle.ts",
  browserTestRunTimedOut: "../execution/attempt_lifecycle.ts",
  browserTestRunErrored: "../execution/attempt_lifecycle.ts",
  reportDownloaded: "../browser_tests/download_report.ts",
  uptimeMonitorTested: "../uptime/test_request.ts",
  incidentOpened: "../incidents/handle_run_finalized.ts",
  incidentResolved: "../incidents/handle_run_finalized.ts",
  alertSent: "../channels/send_queued_notification.ts",
  alertFailed: "../channels/send_queued_notification.ts",
  alertsTopupStarted: "../alerts/start_credit_topup.ts",
  apiKeyUsed: "../../http/routes/public_api.ts",
  billingCheckoutStarted: "../billing/paddle_checkout_intent.ts",
  pushDeviceRegistered: "../push/register_push_device.ts",
} as const satisfies Partial<Record<keyof typeof ACTIVITY_EVENTS, string>>;

const UPTIME_INCIDENT_FILE = "../uptime/handle_check_message.ts";

describe("activity wiring", () => {
  it.each(Object.entries(EXPLICIT_POINTS))(
    "emits %s from its owning module",
    (key, relativePath) => {
      const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
      expect(source).toContain(`ACTIVITY_EVENTS.${key}`);
      expect(source).toMatch(/track\??\.execute\(/u);
    },
  );

  it("emits incident transitions from uptime checks too", () => {
    const source = readFileSync(new URL(UPTIME_INCIDENT_FILE, import.meta.url), "utf8");
    expect(source).toContain("ACTIVITY_EVENTS.incidentOpened");
    expect(source).toContain("ACTIVITY_EVENTS.incidentResolved");
  });

  it("passes the tracker to every consumer in the composition roots", () => {
    const app = readFileSync(new URL("../../app.ts", import.meta.url), "utf8");
    const index = readFileSync(new URL("../../index.ts", import.meta.url), "utf8");
    expect(app).toContain("new TrackEvent(");
    expect(app).toContain("activity: track");          // WriteAudit bridge
    expect((app.match(/\btrack,/gu) ?? []).length).toBeGreaterThanOrEqual(8);
    expect(index).toContain("new TrackEvent(");
  });
});
