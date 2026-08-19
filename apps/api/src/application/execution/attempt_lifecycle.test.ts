import { RecordRunUsage } from "../billing/record_run_usage";
import { ReverseRunUsage } from "../billing/reverse_run_usage";
import type { RunFinalizedHandler } from "../../domain/browser_tests/ports";
import type {
  BrowserTest,
  RunArtifact,
  RunStep,
  TestAttempt,
  TestRun,
} from "../../domain/browser_tests/types";
import type { AttemptMessage } from "../../domain/queues";
import type { Workspace } from "../../domain/workspaces/types";
import { FixedClock } from "../../shared/clock";
import { ATTEMPT_TIMEOUT_MS } from "../../shared/constants";
import { FakeIds } from "../../test/fakes/ids";
import {
  FakeArtifactRepo,
  FakeAttemptRepo,
  FakeBrowserTestRepo,
  FakeRunRepo,
  FakeStepRepo,
} from "../../test/fakes/browser_test_repos";
import {
  FakeUsageEventRepo,
  FakeWorkspaceRepo,
} from "../../test/fakes/repos";
import {
  AttemptLifecycle,
  type AttemptOutcome,
} from "./attempt_lifecycle";

const NOW = 1_700_000_000_000;
const WORKSPACE: Workspace = {
  id: "ws_lifecycle",
  name: "Lifecycle",
  slug: "lifecycle",
  timezone: "UTC",
  ownerUserId: "usr_owner",
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
};
const TEST: BrowserTest = {
  id: "bt_lifecycle",
  workspaceId: WORKSPACE.id,
  name: "Checkout",
  startUrl: "https://example.com",
  instructions: "Verify checkout",
  device: "DESKTOP",
  intervalHours: 6,
  maxRetries: 3,
  notifyOnRecovery: true,
  nextRunAt: NOW + 21_600_000,
  createdBy: "usr_owner",
  updatedBy: "usr_owner",
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
};
const RUN: TestRun = {
  id: "run_lifecycle",
  workspaceId: WORKSPACE.id,
  browserTestId: TEST.id,
  source: "MANUAL",
  status: "QUEUED",
  snapshot: {
    name: TEST.name,
    startUrl: TEST.startUrl,
    instructions: TEST.instructions,
    device: TEST.device,
    intervalHours: TEST.intervalHours,
    maxRetries: TEST.maxRetries,
    notifyOnRecovery: TEST.notifyOnRecovery,
    channelIds: [],
    viewport: { width: 1440, height: 900 },
    modelName: "claude-test",
    runnerVersion: "zenguy-runner/1.0.0",
  },
  scheduledFor: null,
  queuedAt: NOW,
  startedAt: null,
  finishedAt: null,
  durationMs: null,
  attemptCount: 0,
  infraAttempts: 0,
  passedAfterRetry: false,
  billable: true,
  usageEventId: null,
  triggeredByUserId: "usr_owner",
  incidentId: null,
  createdAt: NOW,
};
const ATTEMPT: TestAttempt = {
  id: "att_lifecycle_0",
  testRunId: RUN.id,
  attemptIndex: 0,
  status: "QUEUED",
  retryDelaySeconds: 0,
  queuedAt: NOW,
  startedAt: null,
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
  createdAt: NOW,
};

class RecordingAttemptQueue implements Pick<Queue<AttemptMessage>, "send"> {
  readonly calls: { message: AttemptMessage; delaySeconds: number }[] = [];

  async send(
    message: AttemptMessage,
    options?: QueueSendOptions,
  ): Promise<QueueSendResponse> {
    this.calls.push({
      message: structuredClone(message),
      delaySeconds: options?.delaySeconds ?? 0,
    });
    return { metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } } };
  }
}

class RecordingStorage {
  readonly deleted: string[][] = [];

  async delete(keys: string[]): Promise<void> {
    this.deleted.push([...keys]);
  }
}

class RecordingRunFinalizedHandler implements RunFinalizedHandler {
  readonly runs: TestRun[] = [];

  async handle(run: TestRun): Promise<void> {
    this.runs.push(structuredClone(run));
  }
}

const FAILED: AttemptOutcome = {
  status: "FAILED",
  summary: "Checkout failed",
  expectedResult: "Checkout succeeds",
  actualResult: "Checkout failed",
  failureReason: "Button disabled",
  tokenUsage: 100,
  visitedUrls: ["https://example.com"],
  consoleErrors: [{ message: "error" }],
  networkErrors: [{ statusCode: 500 }],
};
const PASSED: AttemptOutcome = {
  status: "PASSED",
  summary: "Checkout passed",
  expectedResult: "Checkout succeeds",
  actualResult: "Checkout succeeded",
  tokenUsage: 90,
  visitedUrls: ["https://example.com"],
  consoleErrors: [],
  networkErrors: [],
};

async function fixture(options: {
  run?: Partial<TestRun>;
  attempt?: Partial<TestAttempt>;
} = {}) {
  const clock = new FixedClock(NOW);
  const runs = new FakeRunRepo();
  const attempts = new FakeAttemptRepo(runs);
  const steps = new FakeStepRepo();
  const artifacts = new FakeArtifactRepo();
  const tests = new FakeBrowserTestRepo();
  const workspaces = new FakeWorkspaceRepo();
  const usageEvents = new FakeUsageEventRepo();
  const ids = new FakeIds();
  const queue = new RecordingAttemptQueue();
  const storage = new RecordingStorage();
  const finalized = new RecordingRunFinalizedHandler();
  const recordUsage = new RecordRunUsage(usageEvents, clock, ids);
  const realReverseUsage = new ReverseRunUsage(usageEvents, clock);
  const reverseCalls: string[] = [];
  const reverseUsage = {
    execute: async (input: { runId: string }) => {
      reverseCalls.push(input.runId);
      await realReverseUsage.execute(input);
    },
  };
  await workspaces.insert(WORKSPACE);
  await tests.insert(TEST);
  await runs.insert({ ...RUN, ...options.run });
  await attempts.insert({ ...ATTEMPT, ...options.attempt });
  const lifecycle = new AttemptLifecycle({
    runs,
    attempts,
    steps,
    artifacts,
    tests,
    workspaces,
    storage,
    recordUsage,
    reverseUsage,
    queue,
    clock,
    ids,
    runFinalizedHandler: finalized,
  });
  return {
    lifecycle,
    clock,
    runs,
    attempts,
    steps,
    artifacts,
    tests,
    workspaces,
    usageEvents,
    recordUsage,
    queue,
    storage,
    finalized,
    reverseCalls,
  };
}

async function current(
  value: Awaited<ReturnType<typeof fixture>>,
  attemptId: string,
): Promise<{ run: TestRun; attempt: TestAttempt }> {
  const run = await value.runs.findByIdForExecution(RUN.id);
  const attempt = await value.attempts.findById(attemptId);
  if (run === null || attempt === null) throw new Error("fixture state missing");
  return { run, attempt };
}

describe("AttemptLifecycle", () => {
  it("runs the full 26.2 flow with delays and records usage once", async () => {
    const value = await fixture();
    const firstMessage: AttemptMessage = {
      kind: "attempt",
      runId: RUN.id,
      attemptId: ATTEMPT.id,
      attemptIndex: 0,
    };
    await expect(value.lifecycle.claim(firstMessage)).resolves.toBe("execute");
    await expect(value.lifecycle.claim(firstMessage)).resolves.toBe("skip");
    value.clock.advance(100);
    await value.lifecycle.markRunning(RUN.id, ATTEMPT.id, 0);
    value.clock.advance(100);
    let state = await current(value, ATTEMPT.id);
    await value.lifecycle.onAttemptFinished(state.run, state.attempt, FAILED);

    expect(value.queue.calls[0]).toMatchObject({
      delaySeconds: 0,
      message: { runId: RUN.id, attemptIndex: 1 },
    });
    const retryOne = value.queue.calls[0]?.message;
    if (retryOne === undefined) throw new Error("retry one missing");
    value.clock.advance(100);
    await expect(value.lifecycle.claim(retryOne)).resolves.toBe("execute");
    await value.lifecycle.markRunning(RUN.id, retryOne.attemptId, 1);
    value.clock.advance(100);
    state = await current(value, retryOne.attemptId);
    await value.lifecycle.onAttemptFinished(state.run, state.attempt, FAILED);

    expect(value.queue.calls[1]).toMatchObject({
      delaySeconds: 60,
      message: { runId: RUN.id, attemptIndex: 2 },
    });
    const retryTwo = value.queue.calls[1]?.message;
    if (retryTwo === undefined) throw new Error("retry two missing");
    value.clock.advance(60_000);
    await expect(value.lifecycle.claim(retryTwo)).resolves.toBe("execute");
    await value.lifecycle.markRunning(RUN.id, retryTwo.attemptId, 2);
    value.clock.advance(100);
    state = await current(value, retryTwo.attemptId);
    await value.lifecycle.onAttemptFinished(state.run, state.attempt, PASSED);

    await expect(value.runs.findByIdForExecution(RUN.id)).resolves.toMatchObject({
      status: "PASSED",
      attemptCount: 3,
      passedAfterRetry: true,
      billable: true,
    });
    expect(value.queue.calls.map(({ delaySeconds }) => delaySeconds)).toEqual([
      0, 60,
    ]);
    expect(value.usageEvents.events.size).toBe(1);
    expect([...value.usageEvents.events.values()][0]?.reversedAt).toBeNull();
    expect(value.finalized.runs).toHaveLength(1);
    expect(value.finalized.runs[0]).toMatchObject({
      status: "PASSED",
      passedAfterRetry: true,
    });
  });

  it("retries infrastructure failures on the same attempt and removes aborted evidence", async () => {
    const value = await fixture();
    const message: AttemptMessage = {
      kind: "attempt",
      runId: RUN.id,
      attemptId: ATTEMPT.id,
      attemptIndex: 0,
    };
    await value.lifecycle.claim(message);
    await value.lifecycle.markRunning(RUN.id, ATTEMPT.id, 0);
    const step: RunStep = {
      id: "step_aborted",
      attemptId: ATTEMPT.id,
      sequence: 1,
      timestamp: NOW,
      actionType: "navigate",
      description: "Opened",
      urlSanitized: "https://example.com",
      result: "OK",
      artifactId: "art_aborted",
      createdAt: NOW,
    };
    const artifact: RunArtifact = {
      id: "art_aborted",
      workspaceId: WORKSPACE.id,
      runId: RUN.id,
      attemptId: ATTEMPT.id,
      type: "SCREENSHOT",
      storageKey: "ws/ws_lifecycle/run/run_lifecycle/att/att_lifecycle_0/art_aborted.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 10,
      metadataJson: null,
      createdAt: NOW,
      expiresAt: NOW + 1_000,
    };
    await value.steps.insertMany([step]);
    await value.artifacts.insert(artifact);
    const state = await current(value, ATTEMPT.id);
    await value.lifecycle.onAttemptFinished(state.run, state.attempt, {
      status: "SYSTEM_ERROR",
      systemErrorCode: "RUNNER_CRASH",
      visitedUrls: [],
      consoleErrors: [],
      networkErrors: [],
    });

    await expect(value.attempts.findById(ATTEMPT.id)).resolves.toMatchObject({
      id: ATTEMPT.id,
      attemptIndex: 0,
      status: "QUEUED",
      startedAt: null,
      finishedAt: null,
      systemErrorCode: null,
    });
    await expect(value.runs.findByIdForExecution(RUN.id)).resolves.toMatchObject({
      infraAttempts: 1,
      attemptCount: 1,
    });
    await expect(value.steps.listForAttempt(ATTEMPT.id)).resolves.toEqual([]);
    await expect(value.artifacts.findById(artifact.id)).resolves.toBeNull();
    expect(value.storage.deleted).toEqual([[artifact.storageKey]]);
    expect(value.queue.calls).toEqual([
      { message, delaySeconds: 30 },
    ]);
    expect(value.usageEvents.events.size).toBe(1);
  });

  it("reverses a partially recorded usage event when no attempt ever started", async () => {
    const value = await fixture({ run: { infraAttempts: 2 } });
    const usageEventId = await value.recordUsage.execute({
      workspaceId: WORKSPACE.id,
      runId: RUN.id,
      occurredAt: NOW,
    });
    await value.runs.setUsageEventId(RUN.id, usageEventId);
    const message: AttemptMessage = {
      kind: "attempt",
      runId: RUN.id,
      attemptId: ATTEMPT.id,
      attemptIndex: 0,
    };
    await value.lifecycle.claim(message);
    const state = await current(value, ATTEMPT.id);
    await value.lifecycle.onAttemptFinished(state.run, state.attempt, {
      status: "SYSTEM_ERROR",
      systemErrorCode: "BROWSER_LAUNCH_FAILED",
      visitedUrls: [],
      consoleErrors: [],
      networkErrors: [],
    });

    await expect(value.runs.findByIdForExecution(RUN.id)).resolves.toMatchObject({
      status: "SYSTEM_ERROR",
      billable: false,
      startedAt: null,
    });
    expect(value.reverseCalls).toEqual([RUN.id]);
    expect(value.usageEvents.events.get(usageEventId)?.reversedAt).toBe(NOW);
  });

  it("turns a stale running delivery into WORKER_LOST and skips execution", async () => {
    const staleAt = NOW - ATTEMPT_TIMEOUT_MS - 120_001;
    const value = await fixture({
      run: { status: "RUNNING", startedAt: staleAt, infraAttempts: 2 },
      attempt: { status: "RUNNING", startedAt: staleAt },
    });
    const message: AttemptMessage = {
      kind: "attempt",
      runId: RUN.id,
      attemptId: ATTEMPT.id,
      attemptIndex: 0,
    };

    await expect(value.lifecycle.claim(message)).resolves.toBe("skip");
    await expect(value.attempts.findById(ATTEMPT.id)).resolves.toMatchObject({
      status: "SYSTEM_ERROR",
      systemErrorCode: "WORKER_LOST",
    });
    await expect(value.runs.findByIdForExecution(RUN.id)).resolves.toMatchObject({
      status: "SYSTEM_ERROR",
      billable: true,
    });
  });

  it("quietly cancels deleted tests without finalization side effects", async () => {
    const value = await fixture();
    await value.tests.softDelete(TEST.id, NOW);
    const message: AttemptMessage = {
      kind: "attempt",
      runId: RUN.id,
      attemptId: ATTEMPT.id,
      attemptIndex: 0,
    };
    const alert = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(value.lifecycle.claim(message)).resolves.toBe("skip");

    await expect(value.attempts.findById(ATTEMPT.id)).resolves.toMatchObject({
      status: "SYSTEM_ERROR",
      systemErrorCode: "CANCELLED",
    });
    await expect(value.runs.findByIdForExecution(RUN.id)).resolves.toMatchObject({
      status: "SYSTEM_ERROR",
      billable: false,
      attemptCount: 1,
    });
    expect(value.reverseCalls).toEqual([RUN.id]);
    expect(value.finalized.runs).toEqual([]);
    expect(value.queue.calls).toEqual([]);
    expect(alert).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it("quietly cancels a run when its workspace was deleted", async () => {
    const value = await fixture();
    await value.workspaces.softDelete(WORKSPACE.id, NOW);
    await expect(
      value.lifecycle.claim({
        kind: "attempt",
        runId: RUN.id,
        attemptId: ATTEMPT.id,
        attemptIndex: 0,
      }),
    ).resolves.toBe("skip");
    await expect(value.runs.findByIdForExecution(RUN.id)).resolves.toMatchObject({
      status: "SYSTEM_ERROR",
      billable: false,
    });
    await expect(value.attempts.findById(ATTEMPT.id)).resolves.toMatchObject({
      status: "SYSTEM_ERROR",
      systemErrorCode: "CANCELLED",
    });
    expect(value.finalized.runs).toEqual([]);
  });

  it("alerts and skips a missing or mismatched delivery", async () => {
    const value = await fixture();
    const alert = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(
      value.lifecycle.claim({
        kind: "attempt",
        runId: "run_missing",
        attemptId: "att_missing",
        attemptIndex: 0,
      }),
    ).resolves.toBe("skip");
    expect(alert.mock.calls.join(" ")).toContain(
      '"event":"attempt_claim_missing"',
    );
    alert.mockRestore();
  });
});
