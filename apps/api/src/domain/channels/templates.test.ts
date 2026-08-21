import {
  buildNotificationMessage,
  formatDuration,
  type NotificationTemplateInput,
} from "./templates";

const BASE: NotificationTemplateInput = {
  eventType: "FAILURE",
  resourceType: "BROWSER_TEST",
  resourceName: "Checkout Production",
  workspaceName: "Acme",
  appUrl: "https://app.zenguy.test/",
  workspaceId: "ws_123",
  incidentId: "inc_123",
  runId: "run_123",
  occurredAtIso: "2026-08-19T01:02:03.000Z",
  durationMs: 8_040_000,
  failureSummary: "Expected checkout confirmation",
};

describe("buildNotificationMessage", () => {
  it.each([
    ["FAILURE", "BROWSER_TEST"],
    ["FAILURE", "UPTIME_MONITOR"],
    ["RECOVERY", "BROWSER_TEST"],
    ["RECOVERY", "UPTIME_MONITOR"],
    ["TEST", "BROWSER_TEST"],
    ["TEST", "UPTIME_MONITOR"],
  ] as const)("matches the %s %s copy", (eventType, resourceType) => {
    expect(
      buildNotificationMessage({ ...BASE, eventType, resourceType }),
    ).toMatchSnapshot();
  });

  it("uses a run link when there is no incident", () => {
    const { incidentId: _, ...withoutIncident } = BASE;

    expect(buildNotificationMessage(withoutIncident).link).toBe(
      "https://app.zenguy.test/w/ws_123/runs/run_123",
    );
  });

  it("uses the channel page for a standalone test notification", () => {
    const { incidentId: _, runId: __, ...standalone } = BASE;

    expect(
      buildNotificationMessage({ ...standalone, eventType: "TEST" }).link,
    ).toBe("https://app.zenguy.test/w/ws_123/alerts");
  });

  it("bounds failure summaries and removes URLs defensively", () => {
    const privateUrl = "https://private.example.test/path?token=secret";
    const message = buildNotificationMessage({
      ...BASE,
      failureSummary: `${privateUrl} ${"x".repeat(250)}`,
    });
    const summary = message.lines.at(-1) ?? "";

    expect(summary.startsWith("Summary: [redacted-url] ")).toBe(true);
    expect(summary).not.toContain(privateUrl);
    expect(summary.slice("Summary: ".length)).toHaveLength(200);
  });

  it("does not include links or summaries in spoken copy", () => {
    const message = buildNotificationMessage({
      ...BASE,
      failureSummary: "private diagnostic",
    });

    expect(message.speakText).not.toContain(message.link);
    expect(message.speakText).not.toContain("private diagnostic");
  });
});

describe("formatDuration", () => {
  it.each([
    [8_040_000, "2h 14m"],
    [192_000, "3m 12s"],
    [45_999, "45s"],
    [0, "0s"],
    [-1_000, "0s"],
  ])("formats %i ms as %s", (durationMs, expected) => {
    expect(formatDuration(durationMs)).toBe(expected);
  });
});
