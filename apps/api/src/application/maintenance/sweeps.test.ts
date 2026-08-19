import type { SubscriptionStatus } from "../../domain/billing/types";
import type { BrowserTest, TestRun } from "../../domain/browser_tests/types";
import type { CheckMessage } from "../../domain/queues";
import type { UptimeMonitor } from "../../domain/uptime/types";
import type { Workspace } from "../../domain/workspaces/types";
import { FixedClock } from "../../shared/clock";
import { AppError } from "../../shared/errors";
import { FakeBrowserTestRepo, FakeRunRepo } from "../../test/fakes/browser_test_repos";
import { FakeIds } from "../../test/fakes/ids";
import {
  FakeSubscriptionRepo,
  FakeWorkspaceRepo,
} from "../../test/fakes/repos";
import { FakeMonitorRepo } from "../../test/fakes/uptime_repos";
import { SweepDueMonitors } from "./sweep_due_monitors";
import {
  type ScheduledRunCreator,
  SweepDueTests,
} from "./sweep_due_tests";
import { FakeDurableWorkflowRepo } from "../../test/fakes/durable";
import { PublishQueueOutbox } from "../durability/publish_outbox";

const HOUR_MS = 3_600_000;
const NOW = 20 * HOUR_MS;

function workspace(id: string, deletedAt: number | null = null): Workspace {
  return {
    id,
    name: `Workspace ${id}`,
    slug: id,
    timezone: "UTC",
    ownerUserId: `usr_${id}`,
    createdAt: 0,
    updatedAt: deletedAt ?? 0,
    deletedAt,
  };
}

function subscription(workspaceId: string, status: SubscriptionStatus) {
  return {
    id: `sub_${workspaceId}`,
    workspaceId,
    provider: "paddle" as const,
    providerCustomerId: null,
    providerSubscriptionId: null,
    status,
    periodStart: 0,
    periodEnd: NOW + 30 * 24 * HOUR_MS,
    cancelAtPeriodEnd: false,
    updatePaymentUrl: null,
    cancelUrl: null,
    createdAt: 0,
    updatedAt: 0,
  };
}

function browserTest(
  id: string,
  nextRunAt: number,
  overrides: Partial<BrowserTest> = {},
): BrowserTest {
  return {
    id,
    workspaceId: "ws_active",
    name: `Test ${id}`,
    startUrl: "https://example.com",
    instructions: "Verify the page",
    device: "DESKTOP",
    intervalHours: 2,
    maxRetries: 0,
    notifyOnRecovery: true,
    nextRunAt,
    createdBy: "usr_owner",
    updatedBy: "usr_owner",
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
    ...overrides,
  };
}

function monitor(
  id: string,
  nextCheckAt: number,
  overrides: Partial<UptimeMonitor> = {},
): UptimeMonitor {
  return {
    id,
    workspaceId: "ws_active",
    name: `Monitor ${id}`,
    url: "https://example.com/health",
    method: "GET",
    encryptedHeaders: null,
    encryptedBody: null,
    expectedStatus: 200,
    bodyCondition: null,
    bodyExpectedValue: null,
    bodyConditionPath: null,
    frequencySeconds: 300,
    timeoutSeconds: 10,
    maxRetries: 0,
    notifyOnRecovery: true,
    nextCheckAt,
    currentStatus: "UNKNOWN",
    currentCycleId: null,
    cycleStartedAt: null,
    lastCheckAt: null,
    lastResponseTimeMs: null,
    createdBy: "usr_owner",
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
    ...overrides,
  };
}

class RecordingRunCreator implements ScheduledRunCreator {
  readonly inputs: Parameters<ScheduledRunCreator["execute"]>[0][] = [];

  constructor(private readonly error: AppError | null = null) {}

  async execute(
    input: Parameters<ScheduledRunCreator["execute"]>[0],
  ): Promise<void> {
    this.inputs.push(structuredClone(input));
    if (this.error !== null) throw this.error;
  }
}

class RecordingCheckQueue {
  readonly messages: CheckMessage[] = [];
  failures = 0;

  async send(message: CheckMessage): Promise<QueueSendResponse> {
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error("queue unavailable");
    }
    this.messages.push(structuredClone(message));
    return { metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } } };
  }
}

class NoopAnyQueue {
  async send(): Promise<QueueSendResponse> {
    return { metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } } };
  }
}

async function eligibility() {
  const workspaces = new FakeWorkspaceRepo();
  const subscriptions = new FakeSubscriptionRepo();
  await workspaces.insert(workspace("ws_active"));
  await subscriptions.upsertByWorkspace(subscription("ws_active", "ACTIVE"));
  return { workspaces, subscriptions };
}

function activeRun(testId: string): TestRun {
  return {
    id: `run_${testId}`,
    workspaceId: "ws_active",
    browserTestId: testId,
    source: "MANUAL",
    status: "RUNNING",
    snapshot: {
      name: "Active",
      startUrl: "https://example.com",
      instructions: "Verify",
      device: "DESKTOP",
      intervalHours: 2,
      maxRetries: 0,
      notifyOnRecovery: true,
      channelIds: [],
      viewport: { width: 1440, height: 900 },
      modelName: "gpt-5-mini",
      runnerVersion: "test",
    },
    scheduledFor: null,
    queuedAt: NOW - 1_000,
    startedAt: NOW - 500,
    finishedAt: null,
    durationMs: null,
    attemptCount: 1,
    infraAttempts: 0,
    passedAfterRetry: false,
    billable: true,
    usageEventId: null,
    triggeredByUserId: "usr_owner",
    incidentId: null,
    createdAt: NOW - 1_000,
  };
}

describe("SweepDueTests", () => {
  it("selects past and boundary occurrences in schedule order", async () => {
    const tests = new FakeBrowserTestRepo();
    const runs = new FakeRunRepo();
    const creator = new RecordingRunCreator();
    const eligible = await eligibility();
    const logs: { event: string; fields: object | undefined }[] = [];
    for (const value of [
      browserTest("bt_future", NOW + 1),
      browserTest("bt_boundary", NOW),
      browserTest("bt_past", NOW - HOUR_MS),
      browserTest("bt_deleted", NOW - 2 * HOUR_MS, { deletedAt: NOW - 1 }),
    ]) {
      await tests.insert(value);
    }
    const sweep = new SweepDueTests(
      tests,
      runs,
      eligible.workspaces,
      eligible.subscriptions,
      creator,
      new FixedClock(NOW),
      (event, fields) => logs.push({ event, fields }),
    );

    await expect(sweep.execute()).resolves.toEqual({
      due: 2,
      created: 2,
      skipped: 0,
    });
    expect(creator.inputs.map((input) => input.testId)).toEqual([
      "bt_past",
      "bt_boundary",
    ]);
    expect(creator.inputs.map((input) => input.scheduledFor)).toEqual([
      NOW - HOUR_MS,
      NOW,
    ]);
    expect(tests.tests.get("bt_past")?.nextRunAt).toBe(NOW + 2 * HOUR_MS);
    expect(tests.tests.get("bt_future")?.nextRunAt).toBe(NOW + 1);
    expect(logs).toEqual([
      {
        event: "scheduler_tests",
        fields: { due: 2, created: 2, skipped: 0 },
      },
    ]);
  });

  it("claims a racing occurrence once", async () => {
    const tests = new FakeBrowserTestRepo();
    const runs = new FakeRunRepo();
    const creator = new RecordingRunCreator();
    const eligible = await eligibility();
    await tests.insert(browserTest("bt_race", NOW));
    const sweep = new SweepDueTests(
      tests,
      runs,
      eligible.workspaces,
      eligible.subscriptions,
      creator,
      new FixedClock(NOW),
      () => undefined,
    );

    await Promise.all([sweep.execute(), sweep.execute()]);
    expect(creator.inputs).toHaveLength(1);
  });

  it("creates one catch-up run and jumps the next schedule into the future", async () => {
    const tests = new FakeBrowserTestRepo();
    const creator = new RecordingRunCreator();
    const eligible = await eligibility();
    const oldSchedule = NOW - 7 * 24 * HOUR_MS;
    await tests.insert(
      browserTest("bt_catch_up", oldSchedule, { intervalHours: 1 }),
    );
    const sweep = new SweepDueTests(
      tests,
      new FakeRunRepo(),
      eligible.workspaces,
      eligible.subscriptions,
      creator,
      new FixedClock(NOW),
      () => undefined,
    );

    await sweep.execute();
    await sweep.execute();
    expect(creator.inputs).toEqual([
      expect.objectContaining({ scheduledFor: oldSchedule }),
    ]);
    expect(tests.tests.get("bt_catch_up")?.nextRunAt).toBe(NOW + HOUR_MS);
  });

  it("advances but pauses unsubscribed or deleted workspaces and active tests", async () => {
    const tests = new FakeBrowserTestRepo();
    const runs = new FakeRunRepo();
    const creator = new RecordingRunCreator();
    const eligible = await eligibility();
    await eligible.workspaces.insert(workspace("ws_unsubscribed"));
    await eligible.workspaces.insert(workspace("ws_deleted", NOW - 1));
    for (const value of [
      browserTest("bt_unsubscribed", NOW, { workspaceId: "ws_unsubscribed" }),
      browserTest("bt_deleted_ws", NOW, { workspaceId: "ws_deleted" }),
      browserTest("bt_active", NOW),
    ]) {
      await tests.insert(value);
    }
    await runs.insert(activeRun("bt_active"));
    const sweep = new SweepDueTests(
      tests,
      runs,
      eligible.workspaces,
      eligible.subscriptions,
      creator,
      new FixedClock(NOW),
      () => undefined,
    );

    await expect(sweep.execute()).resolves.toEqual({
      due: 3,
      created: 0,
      skipped: 3,
    });
    expect(creator.inputs).toEqual([]);
    expect(tests.tests.get("bt_unsubscribed")?.nextRunAt).toBeGreaterThan(NOW);
  });

  it("swallows an occurrence conflict after a successful claim", async () => {
    const tests = new FakeBrowserTestRepo();
    const eligible = await eligibility();
    await tests.insert(browserTest("bt_duplicate", NOW));
    const sweep = new SweepDueTests(
      tests,
      new FakeRunRepo(),
      eligible.workspaces,
      eligible.subscriptions,
      new RecordingRunCreator(
        new AppError("CONFLICT", "Scheduled occurrence already exists"),
      ),
      new FixedClock(NOW),
      () => undefined,
    );
    await expect(sweep.execute()).resolves.toEqual({
      due: 1,
      created: 0,
      skipped: 1,
    });
  });
});

describe("SweepDueMonitors", () => {
  it("queues past and boundary monitors but skips future, deleted, and open-cycle rows", async () => {
    const monitors = new FakeMonitorRepo();
    const queue = new RecordingCheckQueue();
    const eligible = await eligibility();
    for (const value of [
      monitor("mon_future", NOW + 1),
      monitor("mon_boundary", NOW),
      monitor("mon_past", NOW - 1_000),
      monitor("mon_deleted", NOW - 2_000, { deletedAt: NOW - 1 }),
      monitor("mon_open", NOW - 3_000, {
        currentCycleId: "cyc_existing",
        cycleStartedAt: NOW - 1_000,
      }),
    ]) {
      await monitors.insert(value);
    }
    const clock = new FixedClock(NOW);
    const durable = new FakeDurableWorkflowRepo({ monitors });
    const publisher = new PublishQueueOutbox(
      durable,
      { RUN: new NoopAnyQueue(), CHECK: queue, NOTIFY: new NoopAnyQueue() },
      clock,
    );
    const sweep = new SweepDueMonitors(
      monitors,
      eligible.workspaces,
      eligible.subscriptions,
      durable,
      publisher,
      clock,
      new FakeIds(),
    );

    await expect(sweep.execute()).resolves.toEqual({
      due: 2,
      created: 2,
      skipped: 0,
    });
    expect(queue.messages.map((message) => message.monitorId)).toEqual([
      "mon_past",
      "mon_boundary",
    ]);
    expect(queue.messages).toEqual([
      expect.objectContaining({ kind: "check", attemptIndex: 0 }),
      expect.objectContaining({ kind: "check", attemptIndex: 0 }),
    ]);
    expect(monitors.monitors.get("mon_past")?.nextCheckAt).toBe(
      NOW + 300_000,
    );
    expect(monitors.monitors.get("mon_open")?.nextCheckAt).toBe(NOW - 3_000);
    expect(monitors.monitors.get("mon_open")?.currentCycleId).toBe(
      "cyc_existing",
    );
  });

  it("advances but pauses an unsubscribed monitor", async () => {
    const monitors = new FakeMonitorRepo();
    const queue = new RecordingCheckQueue();
    const eligible = await eligibility();
    await eligible.workspaces.insert(workspace("ws_unsubscribed"));
    await monitors.insert(
      monitor("mon_paused", NOW, { workspaceId: "ws_unsubscribed" }),
    );
    const clock = new FixedClock(NOW);
    const durable = new FakeDurableWorkflowRepo({ monitors });
    const publisher = new PublishQueueOutbox(
      durable,
      { RUN: new NoopAnyQueue(), CHECK: queue, NOTIFY: new NoopAnyQueue() },
      clock,
    );
    const sweep = new SweepDueMonitors(
      monitors,
      eligible.workspaces,
      eligible.subscriptions,
      durable,
      publisher,
      clock,
      new FakeIds(),
    );

    await expect(sweep.execute()).resolves.toEqual({
      due: 1,
      created: 0,
      skipped: 1,
    });
    expect(queue.messages).toEqual([]);
    expect(monitors.monitors.get("mon_paused")?.nextCheckAt).toBeGreaterThan(
      NOW,
    );
    expect(monitors.monitors.get("mon_paused")?.currentCycleId).toBeNull();
  });

  it("claims a monitor race once and opens one cycle", async () => {
    const monitors = new FakeMonitorRepo();
    const queue = new RecordingCheckQueue();
    const eligible = await eligibility();
    await monitors.insert(monitor("mon_race", NOW));
    const clock = new FixedClock(NOW);
    const durable = new FakeDurableWorkflowRepo({ monitors });
    const publisher = new PublishQueueOutbox(
      durable,
      { RUN: new NoopAnyQueue(), CHECK: queue, NOTIFY: new NoopAnyQueue() },
      clock,
    );
    const sweep = new SweepDueMonitors(
      monitors,
      eligible.workspaces,
      eligible.subscriptions,
      durable,
      publisher,
      clock,
      new FakeIds(),
    );

    await Promise.all([sweep.execute(), sweep.execute()]);
    expect(queue.messages).toHaveLength(1);
    expect(monitors.monitors.get("mon_race")?.currentCycleId).toMatch(/^cyc_/u);
  });

  it("keeps an opened cycle recoverable when the initial Queue.send fails", async () => {
    const monitors = new FakeMonitorRepo();
    const queue = new RecordingCheckQueue();
    queue.failures = 1;
    const eligible = await eligibility();
    await monitors.insert(monitor("mon_queue_failure", NOW));
    const clock = new FixedClock(NOW);
    const durable = new FakeDurableWorkflowRepo({ monitors });
    const publisher = new PublishQueueOutbox(
      durable,
      {
        RUN: new NoopAnyQueue(),
        CHECK: queue,
        NOTIFY: new NoopAnyQueue(),
      },
      clock,
    );
    const sweep = new SweepDueMonitors(
      monitors,
      eligible.workspaces,
      eligible.subscriptions,
      durable,
      publisher,
      clock,
      new FakeIds(),
    );
    const alert = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(sweep.execute()).resolves.toEqual({
      due: 1,
      created: 1,
      skipped: 0,
    });
    expect(queue.messages).toEqual([]);
    expect(monitors.monitors.get("mon_queue_failure")?.currentCycleId).toMatch(
      /^cyc_/u,
    );
    expect(
      [...durable.outboxEntries.values()].filter(
        (entry) => entry.publishedAt === null,
      ),
    ).toHaveLength(1);

    await expect(publisher.flush()).resolves.toEqual({
      published: 1,
      failed: 0,
    });
    expect(queue.messages).toHaveLength(1);
    await expect(sweep.execute()).resolves.toEqual({
      due: 0,
      created: 0,
      skipped: 0,
    });
    expect(queue.messages).toHaveLength(1);
    alert.mockRestore();
  });
});
