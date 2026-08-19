import type { ReportGenerator } from "../../domain/browser_tests/ports";
import type {
  RunArtifact,
  RunSnapshot,
  RunStatus,
  TestAttempt,
  TestRun,
} from "../../domain/browser_tests/types";
import type { NotificationChannel } from "../../domain/channels/types";
import type { Incident } from "../../domain/incidents/types";
import type { Workspace } from "../../domain/workspaces/types";
import { FixedClock } from "../../shared/clock";
import { FakeIds } from "../../test/fakes/ids";
import {
  FakeAttemptRepo,
  FakeRunRepo,
} from "../../test/fakes/browser_test_repos";
import {
  FakeIncidentEventRepo,
  FakeIncidentRepo,
} from "../../test/fakes/incident_repos";
import {
  FakeChannelRepo,
  FakeWorkspaceRepo,
} from "../../test/fakes/repos";
import type { DispatchNotifications } from "../channels/dispatch_notifications";
import { HandleRunFinalized } from "./handle_run_finalized";

const NOW = 1_800_000_000_000;
const SNAPSHOT: RunSnapshot = {
  name: "Checkout",
  startUrl: "https://shop.example.com",
  instructions: "Verify checkout with {{SHOP_TOKEN}}.",
  device: "DESKTOP",
  intervalHours: 24,
  maxRetries: 1,
  notifyOnRecovery: true,
  channelIds: ["ch_enabled", "ch_disabled"],
  viewport: { width: 1440, height: 900 },
  modelName: "gpt-5-mini",
  runnerVersion: "test-runner",
};
const WORKSPACE: Workspace = {
  id: "ws_incident_engine",
  name: "Incident Workspace",
  slug: "incident-workspace",
  timezone: "Europe/Madrid",
  ownerUserId: "usr_owner",
  createdAt: NOW - 10_000,
  updatedAt: NOW - 10_000,
  deletedAt: null,
};

function channel(id: string, enabled: boolean): NotificationChannel {
  return {
    id,
    workspaceId: WORKSPACE.id,
    name: id === "ch_enabled" ? "On-call email" : "Disabled SMS",
    type: id === "ch_enabled" ? "EMAIL" : "SMS",
    encryptedConfig: "encrypted",
    enabled,
    verifiedAt: null,
    lastDeliveryStatus: null,
    createdBy: "usr_owner",
    createdAt: NOW - 5_000,
    updatedAt: NOW - 5_000,
  };
}

function run(
  id: string,
  status: RunStatus,
  overrides: Partial<TestRun> = {},
): TestRun {
  return {
    id,
    workspaceId: WORKSPACE.id,
    browserTestId: "bt_checkout",
    source: "SCHEDULED",
    status,
    snapshot: structuredClone(SNAPSHOT),
    scheduledFor: NOW - 10_000,
    queuedAt: NOW - 5_000,
    startedAt: NOW - 4_000,
    finishedAt: NOW,
    durationMs: 4_000,
    attemptCount: 1,
    infraAttempts: 0,
    passedAfterRetry: false,
    billable: true,
    usageEventId: "ue_1",
    triggeredByUserId: null,
    incidentId: null,
    createdAt: NOW - 5_000,
    ...structuredClone(overrides),
  };
}

function attemptFor(
  value: TestRun,
  overrides: Partial<TestAttempt> = {},
): TestAttempt {
  return {
    id: `att_${value.id}`,
    testRunId: value.id,
    attemptIndex: 0,
    status:
      value.status === "SYSTEM_ERROR"
        ? "SYSTEM_ERROR"
        : value.status === "PASSED"
          ? "PASSED"
          : value.status === "TIMEOUT"
            ? "TIMEOUT"
            : "FAILED",
    retryDelaySeconds: 0,
    queuedAt: value.queuedAt,
    startedAt: value.startedAt,
    finishedAt: value.finishedAt,
    durationMs: value.durationMs,
    summary: "Checkout did not complete",
    expectedResult: "Checkout completes",
    actualResult: "Checkout remained open",
    failureReason: "{{SHOP_TOKEN}} was rejected",
    visitedUrlsJson: "[]",
    consoleErrorsJson: "[]",
    networkErrorsJson: "[]",
    tokenUsage: 123,
    modelName: SNAPSHOT.modelName,
    runnerVersion: SNAPSHOT.runnerVersion,
    systemErrorCode:
      value.status === "SYSTEM_ERROR" ? "BROWSER_LAUNCH_FAILED" : null,
    createdAt: value.queuedAt,
    ...structuredClone(overrides),
  };
}

class RecordingDispatch {
  readonly calls: Array<
    Parameters<DispatchNotifications["execute"]>[0]
  > = [];

  async execute(
    input: Parameters<DispatchNotifications["execute"]>[0],
  ): Promise<string[]> {
    this.calls.push(structuredClone(input));
    return [];
  }
}

class RecordingReports implements ReportGenerator {
  readonly runIds: string[] = [];
  fail = false;

  async generateForRun(value: TestRun): Promise<RunArtifact | null> {
    this.runIds.push(value.id);
    if (this.fail) throw new Error("R2 unavailable");
    return null;
  }
}

async function fixture() {
  const incidents = new FakeIncidentRepo();
  const events = new FakeIncidentEventRepo();
  const runs = new FakeRunRepo();
  const attempts = new FakeAttemptRepo();
  const dispatch = new RecordingDispatch();
  const channels = new FakeChannelRepo();
  const workspaces = new FakeWorkspaceRepo();
  const reports = new RecordingReports();
  const clock = new FixedClock(NOW);
  const ids = new FakeIds();
  await workspaces.insert(WORKSPACE);
  await channels.insert(channel("ch_enabled", true));
  await channels.insert(channel("ch_disabled", false));
  const handler = new HandleRunFinalized({
    incidents,
    events,
    runs,
    attempts,
    dispatchNotifications: dispatch,
    channels,
    workspaces,
    reports,
    appUrl: "https://app.zenguy.test",
    clock,
    ids,
  });
  const addRun = async (
    value: TestRun,
    attemptOverrides: Partial<TestAttempt> = {},
  ): Promise<void> => {
    await runs.insert(value);
    await attempts.insert(attemptFor(value, attemptOverrides));
  };
  return {
    incidents,
    events,
    runs,
    attempts,
    dispatch,
    channels,
    workspaces,
    reports,
    clock,
    ids,
    handler,
    addRun,
  };
}

function openIncident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: "inc_open",
    workspaceId: WORKSPACE.id,
    resourceType: "BROWSER_TEST",
    browserTestId: "bt_checkout",
    uptimeMonitorId: null,
    status: "OPEN",
    openedAt: NOW - 60_000,
    resolvedAt: null,
    openedByRunId: "run_original_failure",
    resolvedByRunId: null,
    openedByCheckId: null,
    resolvedByCheckId: null,
    lastEventAt: NOW - 60_000,
    createdAt: NOW - 60_000,
    ...overrides,
  };
}

describe("HandleRunFinalized", () => {
  it("opens and alerts once, then only appends a deduplicated failure", async () => {
    const value = await fixture();
    const first = run("run_first_failure", "FAILED");
    await value.addRun(first);
    await value.handler.handle(first, first.snapshot);

    const incident = await value.incidents.findOpenForTest("bt_checkout");
    expect(incident).toMatchObject({
      status: "OPEN",
      openedByRunId: first.id,
    });
    if (incident === null) throw new Error("incident missing");
    await expect(value.runs.findByIdForExecution(first.id)).resolves.toMatchObject({
      incidentId: incident.id,
    });
    expect(await value.events.listForIncident(incident.id)).toMatchObject([
      {
        type: "OPENED",
        sourceId: first.id,
        message: `Run ${first.id} finished FAILED`,
      },
    ]);
    expect(value.dispatch.calls).toHaveLength(1);
    expect(value.dispatch.calls[0]).toMatchObject({
      workspaceId: WORKSPACE.id,
      channelIds: ["ch_enabled"],
      incidentId: incident.id,
      message: {
        eventType: "FAILURE",
        title: "❌ Checkout failed",
      },
    });
    expect(value.dispatch.calls[0]?.message.lines.join(" ")).toContain(
      "{{SHOP_TOKEN}} was rejected",
    );

    const second = run("run_second_failure", "TIMEOUT", {
      finishedAt: NOW + 1_000,
      scheduledFor: NOW - 9_000,
    });
    await value.addRun(second, { failureReason: "Timed out" });
    await value.handler.handle(second, second.snapshot);

    expect(value.incidents.incidents.size).toBe(1);
    expect(value.dispatch.calls).toHaveLength(1);
    expect(await value.events.listForIncident(incident.id)).toMatchObject([
      { type: "OPENED", sourceId: first.id },
      {
        type: "FAILURE_RECORDED",
        sourceId: second.id,
        message: `Run ${second.id} finished TIMEOUT`,
      },
    ]);
    await expect(value.runs.findByIdForExecution(second.id)).resolves.toMatchObject({
      incidentId: incident.id,
    });
    expect(value.reports.runIds).toEqual([first.id, second.id]);
  });

  it.each([
    { notifyOnRecovery: true, expectedDispatches: 1 },
    { notifyOnRecovery: false, expectedDispatches: 0 },
  ])(
    "resolves a recovery and notification flag=$notifyOnRecovery",
    async ({ notifyOnRecovery, expectedDispatches }) => {
      const value = await fixture();
      const incident = openIncident();
      await value.incidents.insertOpen(incident);
      const recovery = run(`run_recovery_${String(notifyOnRecovery)}`, "PASSED", {
        snapshot: { ...SNAPSHOT, notifyOnRecovery },
      });
      await value.addRun(recovery, {
        summary: "Checkout recovered",
        failureReason: null,
      });

      await value.handler.handle(recovery, recovery.snapshot);

      await expect(
        value.incidents.findById(WORKSPACE.id, incident.id),
      ).resolves.toMatchObject({
        status: "RESOLVED",
        resolvedAt: NOW,
        resolvedByRunId: recovery.id,
      });
      expect(await value.events.listForIncident(incident.id)).toMatchObject([
        { type: "RESOLVED", sourceId: recovery.id },
      ]);
      expect(value.dispatch.calls).toHaveLength(expectedDispatches);
      if (notifyOnRecovery) {
        expect(value.dispatch.calls[0]).toMatchObject({
          message: { eventType: "RECOVERY" },
        });
        expect(value.dispatch.calls[0]?.message.lines).toContain(
          "Downtime: 1m 0s",
        );
      }
      expect(value.reports.runIds).toEqual([]);
    },
  );

  it("does not open customer incidents for validation or system errors", async () => {
    const value = await fixture();
    const validation = run("run_validation", "FAILED", {
      browserTestId: null,
      source: "VALIDATION",
    });
    const systemError = run("run_system", "SYSTEM_ERROR");
    await value.addRun(validation);
    await value.addRun(systemError);
    const alert = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await value.handler.handle(validation, validation.snapshot);
    await value.handler.handle(systemError, systemError.snapshot);

    expect(value.incidents.incidents.size).toBe(0);
    expect(value.events.events.size).toBe(0);
    expect(value.dispatch.calls).toEqual([]);
    expect(value.reports.runIds).toEqual([validation.id]);
    expect(alert.mock.calls.join(" ")).toContain('"event":"run_system_error"');
    expect(alert.mock.calls.join(" ")).toContain(
      '"code":"BROWSER_LAUNCH_FAILED"',
    );
    alert.mockRestore();
  });

  it("does nothing for a passed-after-retry run without an open incident", async () => {
    const value = await fixture();
    const passed = run("run_passed_after_retry", "PASSED", {
      passedAfterRetry: true,
    });
    await value.addRun(passed, { attemptIndex: 1, failureReason: null });

    await value.handler.handle(passed, passed.snapshot);

    expect(value.incidents.incidents.size).toBe(0);
    expect(value.events.events.size).toBe(0);
    expect(value.dispatch.calls).toEqual([]);
    expect(value.reports.runIds).toEqual([]);
  });

  it("does not open or append an incident when a newer browser result is already terminal", async () => {
    const value = await fixture();
    const olderFailure = run("run_order_older_failure", "FAILED", {
      finishedAt: NOW,
      createdAt: NOW - 5_000,
    });
    const newerPass = run("run_order_newer_pass", "PASSED", {
      finishedAt: NOW + 1_000,
      createdAt: NOW + 500,
      scheduledFor: NOW - 9_000,
    });
    await value.addRun(olderFailure);
    await value.addRun(newerPass, { failureReason: null });

    await value.handler.handle(olderFailure, olderFailure.snapshot);

    expect(value.incidents.incidents.size).toBe(0);
    expect(value.events.events.size).toBe(0);
    expect(value.dispatch.calls).toEqual([]);
    // Reports are independent of customer-visible incident ordering.
    expect(value.reports.runIds).toEqual([olderFailure.id]);
  });

  it("does not let an older pass resolve the incident opened by a newer failure", async () => {
    const value = await fixture();
    const olderPass = run("run_order_older_pass", "PASSED", {
      finishedAt: NOW,
      createdAt: NOW - 5_000,
    });
    const newerFailure = run("run_order_newer_failure", "FAILED", {
      finishedAt: NOW + 1_000,
      createdAt: NOW + 500,
      scheduledFor: NOW - 9_000,
    });
    await value.addRun(olderPass, { failureReason: null });
    await value.addRun(newerFailure);
    await value.handler.handle(newerFailure, newerFailure.snapshot);
    const incident = await value.incidents.findOpenForTest("bt_checkout");
    if (incident === null) throw new Error("newer incident missing");

    await value.handler.handle(olderPass, olderPass.snapshot);

    await expect(
      value.incidents.findById(WORKSPACE.id, incident.id),
    ).resolves.toMatchObject({
      status: "OPEN",
      openedByRunId: newerFailure.id,
      resolvedByRunId: null,
    });
    expect(value.dispatch.calls).toHaveLength(1);
    expect(await value.events.listForIncident(incident.id)).toMatchObject([
      { type: "OPENED", sourceId: newerFailure.id },
    ]);
  });

  it("logs and propagates report failures so durable finalization retries", async () => {
    const value = await fixture();
    value.reports.fail = true;
    const failed = run("run_report_failure", "FAILED");
    await value.addRun(failed);
    const alert = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(value.handler.handle(failed, failed.snapshot)).rejects.toThrow(
      "R2 unavailable",
    );

    expect(await value.incidents.findOpenForTest("bt_checkout")).not.toBeNull();
    expect(alert.mock.calls.join(" ")).toContain(
      '"event":"report_generation_failed"',
    );
    alert.mockRestore();
  });
});
