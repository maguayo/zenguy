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
import { FakeDurableWorkflowRepo } from "../../test/fakes/durable";
import { PublishQueueOutbox } from "../durability/publish_outbox";

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
    modelName: "gpt-5-mini",
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
  failures = 0;

  async send(
    message: AttemptMessage,
    options?: QueueSendOptions,
  ): Promise<QueueSendResponse> {
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error("queue unavailable");
    }
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
  const usageEvents = new FakeUsageEventRepo();
  const attempts = new FakeAttemptRepo(runs, usageEvents);
  const steps = new FakeStepRepo();
  const artifacts = new FakeArtifactRepo();
  const tests = new FakeBrowserTestRepo();
  const workspaces = new FakeWorkspaceRepo();
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
  const durable = new FakeDurableWorkflowRepo({
    runs,
    attempts,
    steps,
    artifacts,
  });
  const unusedQueue = {
    send: async () => ({
      metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
    }),
  };
  const outboxPublisher = new PublishQueueOutbox(
    durable,
    { RUN: queue, CHECK: unusedQueue, NOTIFY: unusedQueue },
    clock,
  );
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
    durable,
    outboxPublisher,
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
    durable,
    outboxPublisher,
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
      executionGeneration: ATTEMPT.queuedAt,
    };
    await expect(value.lifecycle.claim(firstMessage)).resolves.toBe("execute");
    await expect(value.lifecycle.claim(firstMessage)).resolves.toBe("skip");
    value.clock.advance(100);
    await value.lifecycle.markRunning(
      RUN.id,
      ATTEMPT.id,
      0,
      firstMessage.executionGeneration,
    );
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
    await value.lifecycle.markRunning(
      RUN.id,
      retryOne.attemptId,
      1,
      retryOne.executionGeneration,
    );
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
    await value.lifecycle.markRunning(
      RUN.id,
      retryTwo.attemptId,
      2,
      retryTwo.executionGeneration,
    );
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

  it("does not persist usage when the atomic start loses its claim", async () => {
    const value = await fixture();
    const message: AttemptMessage = {
      kind: "attempt",
      runId: RUN.id,
      attemptId: ATTEMPT.id,
      attemptIndex: 0,
      executionGeneration: ATTEMPT.queuedAt,
    };
    await expect(value.lifecycle.claim(message)).resolves.toBe("execute");
    vi.spyOn(value.attempts, "markRunning").mockResolvedValueOnce(false);

    await expect(
      value.lifecycle.markRunning(
        RUN.id,
        ATTEMPT.id,
        0,
        message.executionGeneration,
      ),
    ).rejects.toThrow("Attempt is no longer claimable");

    expect(value.usageEvents.events.size).toBe(0);
    await expect(value.runs.findByIdForExecution(RUN.id)).resolves.toMatchObject({
      status: "QUEUED",
      startedAt: null,
      usageEventId: null,
    });
    await expect(value.attempts.findById(ATTEMPT.id)).resolves.toMatchObject({
      status: "STARTING",
    });
  });

  it("recovers an existing usage event and stays idempotent on redelivery", async () => {
    const value = await fixture();
    await value.usageEvents.insertIfAbsent({
      id: "ue_existing_start",
      workspaceId: WORKSPACE.id,
      testRunId: RUN.id,
      type: "BROWSER_RUN",
      quantity: 1,
      billable: true,
      idempotencyKey: `run:${RUN.id}`,
      occurredAt: NOW - 10,
      reversedAt: null,
      createdAt: NOW - 10,
    });
    const message: AttemptMessage = {
      kind: "attempt",
      runId: RUN.id,
      attemptId: ATTEMPT.id,
      attemptIndex: 0,
      executionGeneration: ATTEMPT.queuedAt,
    };
    await expect(value.lifecycle.claim(message)).resolves.toBe("execute");
    await value.lifecycle.markRunning(
      RUN.id,
      ATTEMPT.id,
      0,
      message.executionGeneration,
    );

    await expect(value.lifecycle.claim(message)).resolves.toBe("skip");
    expect(value.usageEvents.events.size).toBe(1);
    await expect(value.runs.findByIdForExecution(RUN.id)).resolves.toMatchObject({
      status: "RUNNING",
      usageEventId: "ue_existing_start",
    });
    await expect(value.attempts.findById(ATTEMPT.id)).resolves.toMatchObject({
      status: "RUNNING",
    });
  });

  it("retries infrastructure failures on the same attempt and removes aborted evidence", async () => {
    const value = await fixture();
    const message: AttemptMessage = {
      kind: "attempt",
      runId: RUN.id,
      attemptId: ATTEMPT.id,
      attemptIndex: 0,
      executionGeneration: ATTEMPT.queuedAt,
    };
    await value.lifecycle.claim(message);
    await value.lifecycle.markRunning(
      RUN.id,
      ATTEMPT.id,
      0,
      message.executionGeneration,
    );
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
      {
        message: {
          ...message,
          executionGeneration: NOW + 30_000,
        },
        delaySeconds: 30,
      },
    ]);
    expect(value.usageEvents.events.size).toBe(1);
  });

  it("ignores a late result from an older infrastructure generation", async () => {
    const value = await fixture();
    const message: AttemptMessage = {
      kind: "attempt",
      runId: RUN.id,
      attemptId: ATTEMPT.id,
      attemptIndex: 0,
      executionGeneration: ATTEMPT.queuedAt,
    };
    await value.lifecycle.claim(message);
    await value.lifecycle.markRunning(
      RUN.id,
      ATTEMPT.id,
      0,
      message.executionGeneration,
    );
    const oldGeneration = await current(value, ATTEMPT.id);
    await value.lifecycle.onAttemptFinished(
      oldGeneration.run,
      oldGeneration.attempt,
      {
        status: "SYSTEM_ERROR",
        systemErrorCode: "RUNNER_CRASH",
        visitedUrls: [],
        consoleErrors: [],
        networkErrors: [],
      },
    );
    value.clock.advance(30_000);
    await expect(value.lifecycle.claim(message)).resolves.toBe("skip");
    const currentGeneration = value.queue.calls[0]?.message;
    if (currentGeneration === undefined) {
      throw new Error("infrastructure retry message missing");
    }
    expect(currentGeneration.executionGeneration).toBe(NOW + 30_000);
    await expect(value.lifecycle.claim(currentGeneration)).resolves.toBe(
      "execute",
    );
    await expect(
      value.lifecycle.markRunning(
        RUN.id,
        ATTEMPT.id,
        0,
        message.executionGeneration,
      ),
    ).rejects.toThrow("Attempt is no longer claimable");
    await value.lifecycle.markRunning(
      RUN.id,
      ATTEMPT.id,
      0,
      currentGeneration.executionGeneration,
    );
    const alert = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await value.lifecycle.onAttemptFinished(
      oldGeneration.run,
      oldGeneration.attempt,
      PASSED,
    );

    await expect(value.attempts.findById(ATTEMPT.id)).resolves.toMatchObject({
      status: "RUNNING",
      finishedAt: null,
    });
    expect(alert.mock.calls.join(" ")).toContain(
      '"event":"stale_attempt_generation_ignored"',
    );
    alert.mockRestore();
  });

  it("recovers a functional retry after Queue.send fails without shortening its delay", async () => {
    const value = await fixture({
      run: { status: "RUNNING", startedAt: NOW, attemptCount: 2 },
      attempt: { attemptIndex: 1, status: "RUNNING", startedAt: NOW },
    });
    value.queue.failures = 1;
    const alert = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const state = await current(value, ATTEMPT.id);

    await expect(
      value.lifecycle.onAttemptFinished(state.run, state.attempt, FAILED),
    ).resolves.toBeUndefined();

    expect(value.queue.calls).toEqual([]);
    const [pending] = [...value.durable.outboxEntries.values()];
    expect(pending).toMatchObject({
      queueKind: "RUN",
      availableAt: NOW + 60_000,
      publishedAt: null,
    });
    const nextMessage = JSON.parse(pending?.payloadJson ?? "null") as AttemptMessage;
    await expect(value.lifecycle.claim(nextMessage)).resolves.toBe("skip");
    value.clock.advance(59_999);
    await expect(value.outboxPublisher.flush()).resolves.toEqual({
      published: 0,
      failed: 0,
    });
    value.clock.advance(1);
    await expect(value.outboxPublisher.flush()).resolves.toEqual({
      published: 1,
      failed: 0,
    });
    expect(value.queue.calls).toEqual([
      { message: nextMessage, delaySeconds: 0 },
    ]);
    await expect(value.lifecycle.claim(nextMessage)).resolves.toBe("execute");
    alert.mockRestore();
  });

  it("replays reverseUsage and terminal side effects after a partial finalization", async () => {
    const value = await fixture({ run: { infraAttempts: 2 } });
    const usageEventId = await value.recordUsage.execute({
      workspaceId: WORKSPACE.id,
      runId: RUN.id,
      occurredAt: NOW,
    });
    await value.runs.setUsageEventId(RUN.id, usageEventId);
    const handler = vi
      .spyOn(value.finalized, "handle")
      .mockRejectedValueOnce(new Error("report unavailable"));
    const message: AttemptMessage = {
      kind: "attempt",
      runId: RUN.id,
      attemptId: ATTEMPT.id,
      attemptIndex: 0,
      executionGeneration: ATTEMPT.queuedAt,
    };
    await value.lifecycle.claim(message);
    const state = await current(value, ATTEMPT.id);

    await expect(
      value.lifecycle.onAttemptFinished(state.run, state.attempt, {
        status: "SYSTEM_ERROR",
        systemErrorCode: "BROWSER_LAUNCH_FAILED",
        visitedUrls: [],
        consoleErrors: [],
        networkErrors: [],
      }),
    ).rejects.toThrow("report unavailable");

    const pending = [...value.durable.jobs.values()].find(
      (job) => job.kind === "RUN_FINALIZATION",
    );
    expect(pending?.status).toBe("PENDING");
    expect(value.reverseCalls).toEqual([RUN.id]);
    await expect(value.lifecycle.claim(message)).resolves.toBe("skip");
    expect(value.reverseCalls).toEqual([RUN.id, RUN.id]);
    expect(value.usageEvents.events.get(usageEventId)?.reversedAt).toBe(NOW);
    expect(value.finalized.runs).toHaveLength(1);
    expect(value.durable.jobs.get(pending?.id ?? "")?.status).toBe("COMPLETED");
    handler.mockRestore();
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
      executionGeneration: ATTEMPT.queuedAt,
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
      executionGeneration: ATTEMPT.queuedAt,
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
      executionGeneration: ATTEMPT.queuedAt,
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

  it.each(["STARTING", "RUNNING"] as const)(
    "does not cancel a deleted test after an attempt owns %s execution",
    async (status) => {
      const value = await fixture({
        run:
          status === "RUNNING"
            ? { status: "RUNNING", startedAt: NOW }
            : { status: "QUEUED" },
        attempt: {
          status,
          startedAt: NOW,
        },
      });
      await value.tests.softDelete(TEST.id, NOW);
      const message: AttemptMessage = {
        kind: "attempt",
        runId: RUN.id,
        attemptId: ATTEMPT.id,
        attemptIndex: 0,
        executionGeneration: ATTEMPT.queuedAt,
      };

      await expect(value.lifecycle.claim(message)).resolves.toBe("skip");

      await expect(value.attempts.findById(ATTEMPT.id)).resolves.toMatchObject({
        status,
        systemErrorCode: null,
        finishedAt: null,
      });
      await expect(value.runs.findByIdForExecution(RUN.id)).resolves.toMatchObject({
        status: status === "RUNNING" ? "RUNNING" : "QUEUED",
        finishedAt: null,
      });
      expect(value.reverseCalls).toEqual([]);
    },
  );

  it("quietly cancels a run when its workspace was deleted", async () => {
    const value = await fixture();
    await value.workspaces.softDelete(WORKSPACE.id, NOW);
    await expect(
      value.lifecycle.claim({
        kind: "attempt",
        runId: RUN.id,
        attemptId: ATTEMPT.id,
        attemptIndex: 0,
        executionGeneration: ATTEMPT.queuedAt,
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
        executionGeneration: 0,
      }),
    ).resolves.toBe("skip");
    expect(alert.mock.calls.join(" ")).toContain(
      '"event":"attempt_claim_missing"',
    );
    alert.mockRestore();
  });
});
