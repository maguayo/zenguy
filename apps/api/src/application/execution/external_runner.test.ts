import { RecordRunUsage } from "../billing/record_run_usage";
import { ReverseRunUsage } from "../billing/reverse_run_usage";
import type {
  BrowserTest,
  TestAttempt,
  TestRun,
} from "../../domain/browser_tests/types";
import type { AttemptMessage } from "../../domain/queues";
import type { Workspace } from "../../domain/workspaces/types";
import { FixedClock } from "../../shared/clock";
import {
  ATTEMPT_TIMEOUT_MS,
  FALLBACK_CLAIM_MIN_AGE_MS,
  INFRA_RETRY_DELAY_SECONDS,
} from "../../shared/constants";
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
import { FakeDurableWorkflowRepo } from "../../test/fakes/durable";
import { PublishQueueOutbox } from "../durability/publish_outbox";
import {
  AttemptLifecycle,
  WORKER_LOST_GRACE_MS,
} from "./attempt_lifecycle";
import { ExternalRunner } from "./external_runner";

const NOW = 1_700_000_000_000;
const WORKSPACE: Workspace = {
  id: "ws_fallback",
  name: "Fallback",
  slug: "fallback",
  timezone: "UTC",
  ownerUserId: "usr_owner",
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
};
const TEST: BrowserTest = {
  id: "bt_fallback",
  workspaceId: WORKSPACE.id,
  name: "Checkout",
  startUrl: "https://example.com",
  instructions: "Verify checkout",
  device: "DESKTOP",
  intervalHours: 6,
  maxRetries: 1,
  notifyOnRecovery: true,
  nextRunAt: NOW + 21_600_000,
  createdBy: "usr_owner",
  updatedBy: "usr_owner",
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
};

function run(id: string, overrides: Partial<TestRun> = {}): TestRun {
  return {
    id,
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
    queuedAt: NOW - FALLBACK_CLAIM_MIN_AGE_MS,
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
    createdAt: NOW - FALLBACK_CLAIM_MIN_AGE_MS,
    ...overrides,
  };
}

function attempt(
  id: string,
  runId: string,
  overrides: Partial<TestAttempt> = {},
): TestAttempt {
  return {
    id,
    testRunId: runId,
    attemptIndex: 0,
    status: "QUEUED",
    retryDelaySeconds: 0,
    queuedAt: NOW - FALLBACK_CLAIM_MIN_AGE_MS,
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
    inputTokens: null,
    outputTokens: null,
    modelName: null,
    runnerVersion: null,
    runnerKind: null,
    systemErrorCode: null,
    createdAt: NOW - FALLBACK_CLAIM_MIN_AGE_MS,
    ...overrides,
  };
}

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

async function fixture(seed: { runs: TestRun[]; attempts: TestAttempt[] }) {
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
  await workspaces.insert(WORKSPACE);
  await tests.insert(TEST);
  for (const entry of seed.runs) await runs.insert(entry);
  for (const entry of seed.attempts) await attempts.insert(entry);
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
  const storage = {
    put: async () => ({ sizeBytes: 0 }),
    delete: async () => undefined,
  };
  const lifecycle = new AttemptLifecycle({
    runs,
    attempts,
    steps,
    artifacts,
    tests,
    workspaces,
    storage,
    recordUsage: new RecordRunUsage(usageEvents, clock, ids),
    reverseUsage: new ReverseRunUsage(usageEvents, clock),
    durable,
    outboxPublisher,
    clock,
    ids,
    runFinalizedHandler: { handle: async () => undefined },
  });
  const resolveSecrets = vi.fn(async () => new Map());
  const runner = new ExternalRunner({
    lifecycle,
    runs,
    attempts,
    steps,
    artifacts,
    storage,
    resolveSecrets: { execute: resolveSecrets },
    clock,
    ids,
    authorizationSigningSecret: "runner-authorization-test-secret".padEnd(32, "-"),
  });
  return { runner, attempts, queue, resolveSecrets };
}

describe("ExternalRunner.claimStale", () => {
  it("skips queued attempts younger than the fallback delay", async () => {
    const fresh = run("run_fresh", { queuedAt: NOW, createdAt: NOW });
    const { runner, attempts } = await fixture({
      runs: [fresh],
      attempts: [
        attempt("att_fresh", fresh.id, {
          queuedAt: NOW - FALLBACK_CLAIM_MIN_AGE_MS + 1,
        }),
      ],
    });

    await expect(
      runner.claimStale({ deliveryId: "fallback-1", workerId: "fallback" }),
    ).resolves.toBeNull();
    await expect(attempts.findById("att_fresh")).resolves.toMatchObject({
      status: "QUEUED",
      startedAt: null,
    });
  });

  it("claims the oldest queued attempt once the fallback delay has passed", async () => {
    const older = run("run_older");
    const fresh = run("run_fresh", {
      browserTestId: null,
      queuedAt: NOW,
      createdAt: NOW,
    });
    const { runner, attempts } = await fixture({
      runs: [older, fresh],
      attempts: [
        attempt("att_older", older.id),
        attempt("att_fresh", fresh.id, { queuedAt: NOW }),
      ],
    });

    const job = await runner.claimStale({
      deliveryId: "fallback-1",
      workerId: "vps-fallback",
    });

    expect(job).toMatchObject({
      reference: {
        runId: older.id,
        attemptId: "att_older",
        attemptIndex: 0,
        executionGeneration: NOW - FALLBACK_CLAIM_MIN_AGE_MS,
        deliveryId: "fallback-1",
      },
      snapshot: { startUrl: TEST.startUrl },
    });
    await expect(attempts.findById("att_older")).resolves.toMatchObject({
      status: "STARTING",
    });
    await expect(
      attempts.isRunnerDeliveryOwner("att_older", "fallback-1"),
    ).resolves.toBe(true);
    expect(attempts.claimedBy.get("att_older")).toBe("vps-fallback");
    await expect(attempts.findById("att_fresh")).resolves.toMatchObject({
      status: "QUEUED",
    });
  });

  it("requires and records the fallback worker identity", async () => {
    const older = run("run_anonymous");
    const { runner, attempts } = await fixture({
      runs: [older],
      attempts: [attempt("att_anonymous", older.id)],
    });

    await expect(
      runner.claimStale({ deliveryId: "fallback-1", workerId: "fallback" }),
    ).resolves.not.toBeNull();
    await expect(attempts.findById("att_anonymous")).resolves.toMatchObject({
      status: "STARTING",
    });
    expect(attempts.claimedBy.get("att_anonymous")).toBe("fallback");
  });

  it("never claims an attempt already taken by the local worker", async () => {
    const taken = run("run_taken", { status: "RUNNING", startedAt: NOW - 20_000 });
    const { runner, attempts } = await fixture({
      runs: [taken],
      attempts: [
        attempt("att_taken", taken.id, {
          status: "RUNNING",
          startedAt: NOW - 20_000,
        }),
      ],
    });

    await expect(
      runner.claimStale({ deliveryId: "fallback-1", workerId: "fallback" }),
    ).resolves.toBeNull();
    await expect(attempts.findById("att_taken")).resolves.toMatchObject({
      status: "RUNNING",
    });
  });

  it("ignores queued attempts whose run already finished", async () => {
    const finished = run("run_finished", {
      status: "PASSED",
      finishedAt: NOW - 1_000,
    });
    const { runner, attempts } = await fixture({
      runs: [finished],
      attempts: [attempt("att_finished", finished.id)],
    });

    await expect(
      runner.claimStale({ deliveryId: "fallback-1", workerId: "fallback" }),
    ).resolves.toBeNull();
    await expect(attempts.findById("att_finished")).resolves.toMatchObject({
      status: "QUEUED",
    });
  });

  it("recovers an abandoned overdue attempt instead of returning it", async () => {
    const abandonedStart = NOW - ATTEMPT_TIMEOUT_MS - WORKER_LOST_GRACE_MS - 1;
    const abandoned = run("run_abandoned", {
      status: "RUNNING",
      startedAt: abandonedStart,
    });
    const { runner, attempts, queue } = await fixture({
      runs: [abandoned],
      attempts: [
        attempt("att_abandoned", abandoned.id, {
          status: "RUNNING",
          startedAt: abandonedStart,
        }),
      ],
    });

    await expect(
      runner.claimStale({ deliveryId: "fallback-1", workerId: "fallback" }),
    ).resolves.toBeNull();
    await expect(attempts.findById("att_abandoned")).resolves.toMatchObject({
      status: "QUEUED",
      queuedAt: NOW + INFRA_RETRY_DELAY_SECONDS * 1_000,
      startedAt: null,
    });
    expect(queue.calls).toEqual([
      {
        message: {
          kind: "attempt",
          runId: abandoned.id,
          attemptId: "att_abandoned",
          attemptIndex: 0,
          executionGeneration: NOW + INFRA_RETRY_DELAY_SECONDS * 1_000,
        },
        delaySeconds: INFRA_RETRY_DELAY_SECONDS,
      },
    ]);
  });
});

describe("ExternalRunner.start", () => {
  it("releases the secret lease only on the STARTING to RUNNING transition", async () => {
    const current = run("run_secret_lease");
    const { runner, resolveSecrets } = await fixture({
      runs: [current],
      attempts: [attempt("att_secret_lease", current.id)],
    });
    resolveSecrets.mockResolvedValue(
      new Map([
        ["PASSWORD", { value: "secret-value", allowedDomains: ["example.com"] }],
      ]),
    );
    const job = await runner.claimStale({
      deliveryId: "fallback-secret-lease",
      workerId: "fallback",
    });
    if (job === null) throw new Error("expected a claimed job");

    await expect(runner.start(job.reference)).resolves.toMatchObject({
      secrets: [
        {
          key: "PASSWORD",
          value: "secret-value",
          allowedDomains: ["example.com"],
        },
      ],
    });
    await expect(runner.start(job.reference)).resolves.toMatchObject({
      secrets: [],
    });
    expect(resolveSecrets).toHaveBeenCalledTimes(1);
  });

  it("grants the secret lease once when two starts race", async () => {
    const current = run("run_secret_race");
    const { runner, resolveSecrets } = await fixture({
      runs: [current],
      attempts: [attempt("att_secret_race", current.id)],
    });
    resolveSecrets.mockResolvedValue(
      new Map([
        ["PASSWORD", { value: "secret-value", allowedDomains: ["example.com"] }],
      ]),
    );
    const job = await runner.claimStale({
      deliveryId: "fallback-secret-race",
      workerId: "fallback",
    });
    if (job === null) throw new Error("expected a claimed job");

    const results = await Promise.allSettled([
      runner.start(job.reference),
      runner.start(job.reference),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect(
      results.find((result) => result.status === "fulfilled"),
    ).toMatchObject({
      value: {
        secrets: [
          {
            key: "PASSWORD",
            value: "secret-value",
            allowedDomains: ["example.com"],
          },
        ],
      },
    });
    expect(resolveSecrets).toHaveBeenCalledTimes(1);
  });
});

describe("ExternalRunner.complete", () => {
  function outcome(overrides: Record<string, unknown> = {}) {
    return {
      status: "PASSED" as const,
      summary: "ok",
      modelName: "gpt-5-mini",
      runnerVersion: "zenguy-fallback-runner/2.0.0",
      visitedUrls: [],
      consoleErrors: [],
      networkErrors: [],
      ...overrides,
    };
  }

  async function claimed() {
    const older = run("run_older");
    const fixtureValue = await fixture({
      runs: [older],
      attempts: [attempt("att_older", older.id)],
    });
    const job = await fixtureValue.runner.claimStale({
      deliveryId: "fallback-1",
      workerId: "fallback",
    });
    if (job === null) throw new Error("expected a claimed job");
    return { ...fixtureValue, reference: job.reference };
  }

  it("stores the token breakdown and runner kind reported by the runner", async () => {
    const { runner, attempts, reference } = await claimed();

    await expect(
      runner.complete(
        reference,
        outcome({
          tokenUsage: 120,
          inputTokens: 100,
          outputTokens: 20,
          runnerKind: "fallback",
        }),
      ),
    ).resolves.toBe(true);

    await expect(attempts.findById("att_older")).resolves.toMatchObject({
      status: "PASSED",
      tokenUsage: 120,
      inputTokens: 100,
      outputTokens: 20,
      runnerKind: "fallback",
      runnerVersion: "zenguy-fallback-runner/2.0.0",
    });
  });

  it.each([
    { runnerVersion: "zenguy-fallback-runner/2.0.0+browser-use-0.13.8", kind: "fallback" },
    { runnerVersion: "zenguy-local-runner/2.0.0+browser-use-0.13.8", kind: "primary" },
    { runnerVersion: "someone-else/1.0.0", kind: null },
  ])(
    "infers the runner kind from $runnerVersion when it is not reported",
    async ({ runnerVersion, kind }) => {
      const { runner, attempts, reference } = await claimed();

      await runner.complete(reference, outcome({ runnerVersion, tokenUsage: 7 }));

      await expect(attempts.findById("att_older")).resolves.toMatchObject({
        runnerKind: kind,
        inputTokens: null,
        outputTokens: null,
        tokenUsage: 7,
      });
    },
  );

  it("derives the total from the breakdown when only the breakdown is reported", async () => {
    const { runner, attempts, reference } = await claimed();

    await runner.complete(
      reference,
      outcome({ inputTokens: 30, outputTokens: 12, runnerKind: "primary" }),
    );

    await expect(attempts.findById("att_older")).resolves.toMatchObject({
      tokenUsage: 42,
      inputTokens: 30,
      outputTokens: 12,
      runnerKind: "primary",
    });
  });
});
