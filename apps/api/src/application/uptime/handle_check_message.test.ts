import type { DispatchNotifications } from "../channels/dispatch_notifications";
import type { NotificationChannel } from "../../domain/channels/types";
import type { Incident } from "../../domain/incidents/types";
import type { CheckMessage } from "../../domain/queues";
import type { MonitorConfig } from "../../domain/uptime/rules";
import type { MonitorStatus, UptimeMonitor } from "../../domain/uptime/types";
import type { Workspace } from "../../domain/workspaces/types";
import { FixedClock } from "../../shared/clock";
import { FakeIds } from "../../test/fakes/ids";
import {
  FakeIncidentEventRepo,
  FakeIncidentRepo,
} from "../../test/fakes/incident_repos";
import { FakeChannelRepo, FakeWorkspaceRepo } from "../../test/fakes/repos";
import { FakeCheckRepo, FakeMonitorRepo } from "../../test/fakes/uptime_repos";
import type { CheckOutcome } from "./execute_check";
import { HandleCheckMessage } from "./handle_check_message";
import { encryptMonitorSensitive } from "./monitor_secrets";

const NOW = Date.UTC(2026, 7, 19, 12, 0, 0);
const KEY = new Uint8Array(32).fill(8);
const WORKSPACE: Workspace = {
  id: "ws_check_cycle",
  name: "Check Cycle Workspace",
  slug: "check-cycle",
  timezone: "UTC",
  ownerUserId: "usr_owner",
  createdAt: NOW - 100_000,
  updatedAt: NOW - 100_000,
  deletedAt: null,
};
const MESSAGE: CheckMessage = {
  kind: "check",
  monitorId: "mon_check_cycle",
  workspaceId: WORKSPACE.id,
  cycleId: "cyc_check_cycle",
  attemptIndex: 0,
};

function channel(): NotificationChannel {
  return {
    id: "ch_check_cycle",
    workspaceId: WORKSPACE.id,
    name: "On-call",
    type: "EMAIL",
    encryptedConfig: "unused",
    enabled: true,
    verifiedAt: NOW - 1,
    lastDeliveryStatus: null,
    createdBy: WORKSPACE.ownerUserId,
    createdAt: NOW - 10_000,
    updatedAt: NOW - 10_000,
  };
}

function failure(reason = "CONNECTION_ERROR"): CheckOutcome {
  return {
    status: "FAILED",
    httpStatus: null,
    responseTimeMs: 125,
    failureReason: reason as CheckOutcome["failureReason"],
    responseExcerpt: "connection failed",
    conditions: [
      { type: "request", passed: false, detail: "connection failed" },
    ],
  };
}

function pass(): CheckOutcome {
  return {
    status: "PASSED",
    httpStatus: 200,
    responseTimeMs: 42,
    failureReason: null,
    responseExcerpt: null,
    conditions: [
      { type: "status", passed: true, detail: "expected 200, got 200" },
    ],
  };
}

class RecordingDispatch {
  readonly calls: Array<Parameters<DispatchNotifications["execute"]>[0]> = [];

  async execute(
    input: Parameters<DispatchNotifications["execute"]>[0],
  ): Promise<string[]> {
    this.calls.push(structuredClone(input));
    return [];
  }
}

class RecordingCheckQueue {
  readonly calls: Array<{
    message: CheckMessage;
    options: QueueSendOptions | undefined;
  }> = [];

  async send(
    message: CheckMessage,
    options?: QueueSendOptions,
  ): Promise<QueueSendResponse> {
    this.calls.push({
      message: structuredClone(message),
      options: options === undefined ? undefined : structuredClone(options),
    });
    return { metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } } };
  }
}

class SequenceExecutor {
  readonly configs: MonitorConfig[] = [];
  calls = 0;

  constructor(private readonly outcomes: CheckOutcome[]) {}

  async execute(config: MonitorConfig): Promise<CheckOutcome> {
    this.configs.push(structuredClone(config));
    const outcome = this.outcomes[this.calls];
    this.calls += 1;
    if (outcome === undefined) throw new Error("No check outcome configured");
    return structuredClone(outcome);
  }
}

function openIncident(monitorId = MESSAGE.monitorId): Incident {
  return {
    id: "inc_existing_uptime",
    workspaceId: WORKSPACE.id,
    resourceType: "UPTIME_MONITOR",
    browserTestId: null,
    uptimeMonitorId: monitorId,
    status: "OPEN",
    openedAt: NOW - 60_000,
    resolvedAt: null,
    openedByRunId: null,
    resolvedByRunId: null,
    openedByCheckId: "chk_original_failure",
    resolvedByCheckId: null,
    lastEventAt: NOW - 60_000,
    createdAt: NOW - 60_000,
  };
}

async function fixture(input: {
  outcomes: CheckOutcome[];
  maxRetries?: number;
  notifyOnRecovery?: boolean;
  currentStatus?: MonitorStatus;
}) {
  const monitors = new FakeMonitorRepo();
  const checks = new FakeCheckRepo();
  const incidents = new FakeIncidentRepo();
  const events = new FakeIncidentEventRepo();
  const channels = new FakeChannelRepo();
  const workspaces = new FakeWorkspaceRepo();
  const dispatch = new RecordingDispatch();
  const queue = new RecordingCheckQueue();
  const executor = new SequenceExecutor(input.outcomes);
  const encrypted = await encryptMonitorSensitive(
    {
      headers: [{ key: "Authorization", value: "Bearer decrypted-token" }],
      body: '{"probe":true}',
    },
    KEY,
  );
  const monitor: UptimeMonitor = {
    id: MESSAGE.monitorId,
    workspaceId: WORKSPACE.id,
    name: "API health",
    url: "https://api.example.com/health",
    method: "POST",
    ...encrypted,
    expectedStatus: 200,
    bodyCondition: null,
    bodyExpectedValue: null,
    bodyConditionPath: null,
    frequencySeconds: 300,
    timeoutSeconds: 10,
    maxRetries: input.maxRetries ?? 0,
    notifyOnRecovery: input.notifyOnRecovery ?? true,
    nextCheckAt: NOW + 300_000,
    currentStatus: input.currentStatus ?? "UNKNOWN",
    currentCycleId: MESSAGE.cycleId,
    cycleStartedAt: NOW - 1_000,
    lastCheckAt: null,
    lastResponseTimeMs: null,
    createdBy: WORKSPACE.ownerUserId,
    createdAt: NOW - 100_000,
    updatedAt: NOW - 1_000,
    deletedAt: null,
  };
  await monitors.insert(monitor);
  await monitors.setChannels(monitor.id, ["ch_check_cycle"]);
  await workspaces.insert(WORKSPACE);
  await channels.insert(channel());
  const handler = new HandleCheckMessage({
    monitors,
    checks,
    incidents,
    events,
    channels,
    workspaces,
    dispatchNotifications: dispatch,
    checkQueue: queue,
    executeCheck: (config) => executor.execute(config),
    encryptionKey: KEY,
    appUrl: "https://app.zenguy.test",
    clock: new FixedClock(NOW),
    ids: new FakeIds(),
  });
  return {
    monitors,
    checks,
    incidents,
    events,
    channels,
    workspaces,
    dispatch,
    queue,
    executor,
    monitor,
    handler,
  };
}

describe("HandleCheckMessage", () => {
  it("matches the fail-then-immediate-pass example without opening an incident", async () => {
    const value = await fixture({
      outcomes: [failure(), pass()],
      maxRetries: 1,
    });

    await value.handler.execute(MESSAGE);

    expect(value.queue.calls).toEqual([
      {
        message: { ...MESSAGE, attemptIndex: 1 },
        options: { delaySeconds: 0 },
      },
    ]);
    await expect(
      value.monitors.findById(WORKSPACE.id, MESSAGE.monitorId),
    ).resolves.toMatchObject({
      currentStatus: "UNKNOWN",
      currentCycleId: MESSAGE.cycleId,
    });
    expect(value.incidents.incidents.size).toBe(0);
    expect(value.dispatch.calls).toHaveLength(0);
    expect(value.executor.configs[0]).toMatchObject({
      headers: [{ key: "Authorization", value: "Bearer decrypted-token" }],
      body: '{"probe":true}',
      channelIds: ["ch_check_cycle"],
    });

    await value.handler.execute({ ...MESSAGE, attemptIndex: 1 });

    await expect(
      value.monitors.findById(WORKSPACE.id, MESSAGE.monitorId),
    ).resolves.toMatchObject({
      currentStatus: "UP",
      currentCycleId: null,
      lastResponseTimeMs: 42,
    });
    expect(value.checks.checks.size).toBe(2);
    expect(value.incidents.incidents.size).toBe(0);
    expect(value.dispatch.calls).toHaveLength(0);
  });

  it("exhausts the retry ladder, transitions DOWN, and alerts once", async () => {
    const value = await fixture({
      outcomes: [failure(), failure(), failure()],
      maxRetries: 2,
    });
    await value.handler.execute(MESSAGE);
    await value.handler.execute({ ...MESSAGE, attemptIndex: 1 });
    await value.handler.execute({ ...MESSAGE, attemptIndex: 2 });

    expect(value.queue.calls.map((call) => call.options)).toEqual([
      { delaySeconds: 0 },
      { delaySeconds: 60 },
    ]);
    await expect(
      value.monitors.findById(WORKSPACE.id, MESSAGE.monitorId),
    ).resolves.toMatchObject({ currentStatus: "DOWN", currentCycleId: null });
    expect(value.checks.checks.size).toBe(3);
    expect(value.incidents.incidents.size).toBe(1);
    const incident = [...value.incidents.incidents.values()][0]!;
    expect(incident).toMatchObject({
      resourceType: "UPTIME_MONITOR",
      uptimeMonitorId: MESSAGE.monitorId,
      openedByCheckId: expect.stringMatching(/^chk_/u),
    });
    await expect(value.events.listForIncident(incident.id)).resolves.toMatchObject([
      { type: "OPENED", sourceId: incident.openedByCheckId },
    ]);
    expect(value.dispatch.calls).toHaveLength(1);
    expect(value.dispatch.calls[0]).toMatchObject({
      incidentId: incident.id,
      message: {
        eventType: "FAILURE",
        title: "🔴 API health is down",
        lines: expect.arrayContaining([
          "Summary: CONNECTION_ERROR: connection failed",
        ]),
      },
    });
  });

  it("resolves an open incident and sends recovery when configured", async () => {
    const value = await fixture({
      outcomes: [pass()],
      currentStatus: "DOWN",
      notifyOnRecovery: true,
    });
    const incident = openIncident();
    await value.incidents.insertOpen(incident);

    await value.handler.execute(MESSAGE);

    await expect(
      value.incidents.findById(WORKSPACE.id, incident.id),
    ).resolves.toMatchObject({
      status: "RESOLVED",
      resolvedAt: NOW,
      resolvedByCheckId: expect.stringMatching(/^chk_/u),
    });
    await expect(value.events.listForIncident(incident.id)).resolves.toMatchObject([
      { type: "RESOLVED", sourceId: expect.stringMatching(/^chk_/u) },
    ]);
    expect(value.dispatch.calls).toHaveLength(1);
    expect(value.dispatch.calls[0]?.message).toMatchObject({
      eventType: "RECOVERY",
      title: "✅ API health recovered",
    });
  });

  it("appends a failure without re-alerting when an incident is already open", async () => {
    const value = await fixture({
      outcomes: [failure()],
      maxRetries: 0,
      currentStatus: "DOWN",
    });
    const incident = openIncident();
    await value.incidents.insertOpen(incident);

    await value.handler.execute(MESSAGE);

    expect(value.incidents.incidents.size).toBe(1);
    await expect(value.events.listForIncident(incident.id)).resolves.toMatchObject([
      { type: "FAILURE_RECORDED", sourceId: expect.stringMatching(/^chk_/u) },
    ]);
    expect(value.dispatch.calls).toHaveLength(0);
  });

  it("acks sequential redelivery without executing or producing effects twice", async () => {
    const value = await fixture({ outcomes: [failure()], maxRetries: 0 });

    await value.handler.execute(MESSAGE);
    await value.handler.execute(MESSAGE);

    expect(value.executor.calls).toBe(1);
    expect(value.checks.checks.size).toBe(1);
    expect(value.incidents.incidents.size).toBe(1);
    expect(value.dispatch.calls).toHaveLength(1);
  });

  it("acks a monitor deleted mid-cycle and a stale cycle without checking", async () => {
    const deleted = await fixture({ outcomes: [pass()] });
    await deleted.monitors.softDelete(MESSAGE.monitorId, NOW);
    await deleted.handler.execute(MESSAGE);
    expect(deleted.executor.calls).toBe(0);
    expect(deleted.checks.checks.size).toBe(0);

    const stale = await fixture({ outcomes: [pass()] });
    await stale.handler.execute({ ...MESSAGE, cycleId: "cyc_stale" });
    expect(stale.executor.calls).toBe(0);
    expect(stale.checks.checks.size).toBe(0);
  });
});
