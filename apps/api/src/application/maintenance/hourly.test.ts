import { ReverseRunUsage } from "../billing/reverse_run_usage";
import { AttemptLifecycle } from "../execution/attempt_lifecycle";
import { NoopRunFinalizedHandler } from "../../domain/browser_tests/ports";
import type { TestAttempt, TestRun } from "../../domain/browser_tests/types";
import type { AttemptMessage } from "../../domain/queues";
import type { UptimeMonitor } from "../../domain/uptime/types";
import { FixedClock } from "../../shared/clock";
import { ATTEMPT_TIMEOUT_MS } from "../../shared/constants";
import type { LogFields } from "../../shared/log";
import {
  FakeArtifactRepo,
  FakeAttemptRepo,
  FakeBrowserTestRepo,
  FakeRunRepo,
  FakeStepRepo,
} from "../../test/fakes/browser_test_repos";
import { FakeIds } from "../../test/fakes/ids";
import {
  FakeUsageEventRepo,
  FakeWorkspaceRepo,
} from "../../test/fakes/repos";
import { FakeMonitorRepo } from "../../test/fakes/uptime_repos";
import { HourlyMaintenance } from "./hourly";

const NOW = 1_800_000_000_000;
const STALE_AT = NOW - ATTEMPT_TIMEOUT_MS - 600_001;

const RUN: TestRun = {
  id: "run_hourly",
  workspaceId: "ws_hourly",
  browserTestId: "bt_hourly",
  source: "SCHEDULED",
  status: "QUEUED",
  snapshot: {
    name: "Hourly",
    startUrl: "https://example.com",
    instructions: "Verify",
    device: "DESKTOP",
    intervalHours: 1,
    maxRetries: 0,
    notifyOnRecovery: true,
    channelIds: [],
    viewport: { width: 1440, height: 900 },
    modelName: "gpt-5-mini",
    runnerVersion: "zenguy-runner/1.0.0",
  },
  scheduledFor: NOW - 1_000,
  queuedAt: STALE_AT,
  startedAt: null,
  finishedAt: null,
  durationMs: null,
  attemptCount: 0,
  infraAttempts: 2,
  passedAfterRetry: false,
  billable: true,
  usageEventId: "use_hourly",
  triggeredByUserId: null,
  incidentId: null,
  createdAt: STALE_AT,
};

const ATTEMPT: TestAttempt = {
  id: "att_hourly",
  testRunId: RUN.id,
  attemptIndex: 0,
  status: "STARTING",
  retryDelaySeconds: 0,
  queuedAt: STALE_AT,
  startedAt: STALE_AT,
  finishedAt: null,
  durationMs: null,
  summary: null,
  expectedResult: null,
  actualResult: null,
  failureReason: null,
  visitedUrlsJson: null,
  consoleErrorsJson: null,
  networkErrorsJson: null,
  tokenUsage: null,
  modelName: null,
  runnerVersion: null,
  systemErrorCode: null,
  createdAt: STALE_AT,
};

function monitor(
  id: string,
  cycleStartedAt: number,
): UptimeMonitor {
  return {
    id,
    workspaceId: "ws_hourly",
    name: id,
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
    nextCheckAt: NOW,
    currentStatus: "DOWN",
    currentCycleId: `cyc_${id}`,
    cycleStartedAt,
    lastCheckAt: NOW - 1_000,
    lastResponseTimeMs: 500,
    createdBy: "usr_hourly",
    createdAt: NOW - 10_000,
    updatedAt: cycleStartedAt,
    deletedAt: null,
  };
}

class NoopQueue implements Pick<Queue<AttemptMessage>, "send"> {
  async send(): Promise<QueueSendResponse> {
    return { metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } } };
  }
}

describe("HourlyMaintenance", () => {
  it("uses the normal SYSTEM_ERROR path, reverses unused usage, and clears stale cycles", async () => {
    const clock = new FixedClock(NOW);
    const runs = new FakeRunRepo();
    const attempts = new FakeAttemptRepo(runs);
    const usage = new FakeUsageEventRepo();
    const monitors = new FakeMonitorRepo();
    await runs.insert(RUN);
    await attempts.insert(ATTEMPT);
    await usage.insertIfAbsent({
      id: "use_hourly",
      workspaceId: RUN.workspaceId,
      testRunId: RUN.id,
      type: "BROWSER_RUN",
      quantity: 1,
      billable: true,
      idempotencyKey: "usage.hourly",
      occurredAt: STALE_AT,
      reversedAt: null,
      createdAt: STALE_AT,
    });
    await monitors.insert(monitor("mon_stale", NOW - 900_001));
    await monitors.insert(monitor("mon_boundary", NOW - 900_000));
    const lifecycle = new AttemptLifecycle({
      runs,
      attempts,
      steps: new FakeStepRepo(),
      artifacts: new FakeArtifactRepo(),
      tests: new FakeBrowserTestRepo(),
      workspaces: new FakeWorkspaceRepo(),
      storage: { delete: async () => undefined },
      recordUsage: { execute: async () => "unused" },
      reverseUsage: new ReverseRunUsage(usage, clock),
      queue: new NoopQueue(),
      clock,
      ids: new FakeIds(),
      runFinalizedHandler: new NoopRunFinalizedHandler(),
    });
    let overageCalls = 0;
    const alerts: { event: string; fields?: LogFields }[] = [];
    const hourly = new HourlyMaintenance(
      { execute: async () => { overageCalls += 1; } },
      attempts,
      runs,
      lifecycle,
      monitors,
      clock,
      (event, fields) => alerts.push({ event, ...(fields === undefined ? {} : { fields }) }),
    );

    await expect(hourly.execute()).resolves.toEqual({
      zombieAttempts: 1,
      zombieCycles: 1,
    });
    expect(overageCalls).toBe(1);
    await expect(attempts.findById(ATTEMPT.id)).resolves.toMatchObject({
      status: "SYSTEM_ERROR",
      systemErrorCode: "WORKER_LOST",
      failureReason: "Attempt worker stopped responding",
    });
    await expect(runs.findByIdForExecution(RUN.id)).resolves.toMatchObject({
      status: "SYSTEM_ERROR",
      billable: false,
      startedAt: null,
    });
    expect(usage.events.get("use_hourly")?.reversedAt).toBe(NOW);
    await expect(
      monitors.findById("ws_hourly", "mon_stale"),
    ).resolves.toMatchObject({ currentStatus: "DOWN", currentCycleId: null });
    await expect(
      monitors.findById("ws_hourly", "mon_boundary"),
    ).resolves.toMatchObject({ currentCycleId: "cyc_mon_boundary" });
    expect(alerts.map((alert) => alert.event)).toEqual([
      "zombie_attempt",
      "zombie_cycle",
    ]);
  });
});
