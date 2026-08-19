import type {
  BrowserTest,
  RunArtifact,
  RunSnapshot,
  RunStatus,
  RunStep,
  TestAttempt,
  TestRun,
} from "../../domain/browser_tests/types";
import { freshDb, testEnv } from "../../test/helpers";
import { D1ArtifactRepo } from "./artifact_repo";
import { D1AttemptRepo } from "./attempt_repo";
import { D1BrowserTestRepo } from "./browser_test_repo";
import { D1RunRepo } from "./run_repo";
import { D1StepRepo } from "./step_repo";

const SNAPSHOT: RunSnapshot = {
  name: "Checkout",
  startUrl: "https://example.com",
  instructions: "Verify checkout",
  device: "DESKTOP",
  intervalHours: 1,
  maxRetries: 2,
  notifyOnRecovery: true,
  channelIds: ["ch_1"],
  viewport: { width: 1440, height: 900 },
  modelName: "gpt-5-mini",
  runnerVersion: "zenguy-runner/1.0.0",
};

function browserTest(
  id: string,
  nextRunAt: number,
  workspaceId = "ws_1",
  createdAt = 1,
): BrowserTest {
  return {
    id,
    workspaceId,
    name: `Test ${id}`,
    startUrl: "https://example.com",
    instructions: "Verify it",
    device: "DESKTOP",
    intervalHours: 1,
    maxRetries: 2,
    notifyOnRecovery: true,
    nextRunAt,
    createdBy: "usr_1",
    updatedBy: "usr_1",
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
  };
}

function testRun(input: {
  id: string;
  testId: string | null;
  status: RunStatus;
  createdAt: number;
  workspaceId?: string;
  scheduledFor?: number | null;
}): TestRun {
  const terminal = !["QUEUED", "RUNNING"].includes(input.status);
  return {
    id: input.id,
    workspaceId: input.workspaceId ?? "ws_1",
    browserTestId: input.testId,
    source: input.scheduledFor === undefined ? "MANUAL" : "SCHEDULED",
    status: input.status,
    snapshot: structuredClone(SNAPSHOT),
    scheduledFor: input.scheduledFor ?? null,
    queuedAt: input.createdAt,
    startedAt: terminal ? input.createdAt : null,
    finishedAt: terminal ? input.createdAt + 10 : null,
    durationMs: terminal ? 10 : null,
    attemptCount: terminal ? 1 : 0,
    infraAttempts: 0,
    passedAfterRetry: false,
    billable: true,
    usageEventId: null,
    triggeredByUserId: "usr_1",
    incidentId: null,
    createdAt: input.createdAt,
  };
}

function attempt(id = "att_1"): TestAttempt {
  return {
    id,
    testRunId: "run_1",
    attemptIndex: 0,
    status: "RUNNING",
    retryDelaySeconds: 60,
    queuedAt: 100,
    startedAt: 200,
    finishedAt: 300,
    durationMs: 100,
    summary: "summary",
    expectedResult: "expected",
    actualResult: "actual",
    failureReason: "failure",
    visitedUrlsJson: '["https://example.com"]',
    consoleErrorsJson: '["console"]',
    networkErrorsJson: '["network"]',
    tokenUsage: 123,
    modelName: "gpt-5-mini",
    runnerVersion: "runner-test",
    systemErrorCode: "WORKER_LOST",
    createdAt: 100,
  };
}

describe("D1 browser test repositories", () => {
  beforeEach(freshDb);

  it("round-trips tests, channels, soft deletion, and optimistic due claims", async () => {
    const repo = new D1BrowserTestRepo(testEnv().DB);
    const due = browserTest("bt_due", 500, "ws_1", 1);
    const future = browserTest("bt_future", 5_000, "ws_1", 2);
    const other = browserTest("bt_other", 5_000, "ws_2", 3);
    await repo.insert(due);
    await repo.insert(future);
    await repo.insert(other);
    await repo.update(
      due.id,
      {
        name: "Renamed",
        device: "MOBILE",
        notifyOnRecovery: false,
        updatedBy: "usr_2",
      },
      10,
    );
    await expect(repo.findById("ws_1", due.id)).resolves.toMatchObject({
      name: "Renamed",
      device: "MOBILE",
      notifyOnRecovery: false,
      updatedBy: "usr_2",
      updatedAt: 10,
    });
    await expect(repo.findById("ws_2", due.id)).resolves.toBeNull();
    await repo.setChannels(due.id, ["ch_2", "ch_1", "ch_2"]);
    await expect(repo.getChannelIds(due.id)).resolves.toEqual(["ch_1", "ch_2"]);

    const [firstClaim, secondClaim] = await Promise.all([
      repo.claimDue(1_000, 10),
      new D1BrowserTestRepo(testEnv().DB).claimDue(1_000, 10),
    ]);
    const claimed = [...firstClaim, ...secondClaim];
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({
      id: due.id,
      scheduledFor: 500,
      nextRunAt: 3_601_000,
    });
    await expect(repo.claimDue(1_000, 10)).resolves.toEqual([]);
    await repo.setNextRunAt(future.id, 6_000);
    await expect(repo.findById("ws_1", future.id)).resolves.toMatchObject({
      nextRunAt: 6_000,
    });

    await repo.softDelete(due.id, 20);
    await expect(repo.findById("ws_1", due.id)).resolves.toBeNull();
    await expect(repo.list("ws_1")).resolves.toEqual([
      expect.objectContaining({ id: future.id }),
    ]);
  });

  it("enforces run uniqueness and supports state, summaries, and keyset lists", async () => {
    const runs = new D1RunRepo(testEnv().DB);
    const active = testRun({
      id: "run_active",
      testId: "bt_1",
      status: "QUEUED",
      createdAt: 400,
      scheduledFor: 100,
    });
    await runs.insert(active);
    await expect(
      runs.insert(
        testRun({
          id: "run_second_active",
          testId: "bt_1",
          status: "RUNNING",
          createdAt: 500,
          scheduledFor: 101,
        }),
      ),
    ).rejects.toThrow();
    await expect(
      runs.insert(
        testRun({
          id: "run_same_occurrence",
          testId: "bt_1",
          status: "PASSED",
          createdAt: 500,
          scheduledFor: 100,
        }),
      ),
    ).rejects.toThrow();
    await expect(
      runs.insert(
        testRun({
          id: "run_other_test",
          testId: "bt_2",
          status: "QUEUED",
          createdAt: 500,
        }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      Promise.all([
        runs.insert(
          testRun({ id: "run_draft_1", testId: null, status: "QUEUED", createdAt: 1 }),
        ),
        runs.insert(
          testRun({ id: "run_draft_2", testId: null, status: "QUEUED", createdAt: 2 }),
        ),
      ]),
    ).resolves.toBeDefined();

    const older = testRun({
      id: "run_old",
      testId: "bt_1",
      status: "FAILED",
      createdAt: 100,
    });
    const middle = testRun({
      id: "run_middle",
      testId: "bt_1",
      status: "PASSED",
      createdAt: 200,
    });
    const newest = testRun({
      id: "run_new",
      testId: "bt_1",
      status: "TIMEOUT",
      createdAt: 300,
    });
    for (const value of [older, middle, newest]) await runs.insert(value);
    await expect(runs.listForTest("bt_1", null, 2)).resolves.toEqual([
      active,
      newest,
    ]);
    await expect(
      runs.listForTest(
        "bt_1",
        { createdAt: newest.createdAt, id: newest.id },
        2,
      ),
    ).resolves.toEqual([middle, older]);
    await expect(
      runs.listForTest("bt_1", null, 10, "PASSED"),
    ).resolves.toEqual([middle]);

    await runs.updateStatus(active.id, "RUNNING", 600);
    await expect(runs.activeRunExists("bt_1")).resolves.toBe(true);
    await expect(runs.countRunning("ws_1")).resolves.toBe(1);
    await runs.setUsageEventId(active.id, "ue_1");
    await runs.setIncidentId(active.id, "inc_1");
    await expect(runs.incrementInfraAttempts(active.id)).resolves.toBe(1);
    await expect(runs.incrementInfraAttempts(active.id)).resolves.toBe(2);
    await runs.finalize(active.id, {
      status: "PASSED",
      finishedAt: 700,
      durationMs: 300,
      attemptCount: 2,
      passedAfterRetry: true,
      billable: true,
    });
    await expect(runs.findById("ws_1", active.id)).resolves.toMatchObject({
      status: "PASSED",
      startedAt: 600,
      finishedAt: 700,
      durationMs: 300,
      attemptCount: 2,
      infraAttempts: 2,
      passedAfterRetry: true,
      usageEventId: "ue_1",
      incidentId: "inc_1",
    });
    await expect(runs.activeRunExists("bt_1")).resolves.toBe(false);
    await expect(runs.countRunning("ws_1")).resolves.toBe(0);
    const summaries = await runs.lastRunSummaryPerTest("ws_1");
    expect(summaries.get("bt_1")).toMatchObject({
      id: active.id,
      status: "PASSED",
    });
    expect(summaries.has("bt_2")).toBe(false);

    const atomicAttempts = new D1AttemptRepo(testEnv().DB);
    const collision = attempt("att_collision");
    await atomicAttempts.insert(collision);
    const rolledBack = testRun({
      id: "run_rolled_back",
      testId: null,
      status: "QUEUED",
      createdAt: 800,
    });
    await expect(
      runs.insertWithAttempt(rolledBack, {
        ...collision,
        testRunId: rolledBack.id,
      }),
    ).rejects.toThrow();
    await expect(
      runs.findById("ws_1", rolledBack.id),
    ).resolves.toBeNull();
    const atomic = testRun({
      id: "run_atomic",
      testId: null,
      status: "QUEUED",
      createdAt: 900,
    });
    const atomicAttempt = {
      ...attempt("att_atomic"),
      testRunId: atomic.id,
      status: "QUEUED" as const,
    };
    await runs.insertWithAttempt(atomic, atomicAttempt);
    await expect(runs.findById("ws_1", atomic.id)).resolves.toEqual(atomic);
    await expect(atomicAttempts.listForRun(atomic.id)).resolves.toEqual([
      atomicAttempt,
    ]);
  });

  it("resets attempts and round-trips ordered steps and artifacts", async () => {
    const attempts = new D1AttemptRepo(testEnv().DB);
    const steps = new D1StepRepo(testEnv().DB);
    const artifacts = new D1ArtifactRepo(testEnv().DB);
    const running = attempt();
    await attempts.insert(running);
    await expect(attempts.findByRunAndIndex("run_1", 0)).resolves.toEqual(
      running,
    );
    await expect(attempts.listStale(201)).resolves.toEqual([running]);
    await expect(attempts.listStale(200)).resolves.toEqual([]);
    await expect(
      attempts.insert({ ...running, id: "att_duplicate" }),
    ).rejects.toThrow();

    await attempts.resetForInfraRetry(running.id, 500);
    await expect(attempts.findById(running.id)).resolves.toEqual({
      ...running,
      status: "QUEUED",
      queuedAt: 500,
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
    });
    await attempts.update(running.id, {
      status: "STARTING",
      startedAt: 600,
      summary: "new summary",
    });
    await expect(attempts.listForRun("run_1")).resolves.toEqual([
      expect.objectContaining({
        status: "STARTING",
        startedAt: 600,
        summary: "new summary",
      }),
    ]);

    const stepValues: RunStep[] = [
      {
        id: "step_2",
        attemptId: running.id,
        sequence: 2,
        timestamp: 2,
        actionType: "click",
        description: "Clicked",
        urlSanitized: "https://example.com",
        result: "OK",
        artifactId: null,
        createdAt: 2,
      },
      {
        id: "step_1",
        attemptId: running.id,
        sequence: 1,
        timestamp: 1,
        actionType: "navigate",
        description: "Opened",
        urlSanitized: "https://example.com",
        result: "OK",
        artifactId: "art_screen",
        createdAt: 1,
      },
    ];
    await steps.insertMany(stepValues);
    await expect(steps.listForAttempt(running.id)).resolves.toEqual([
      stepValues[1],
      stepValues[0],
    ]);
    await expect(
      steps.insertMany([{ ...stepValues[0]!, id: "step_duplicate" }]),
    ).rejects.toThrow();

    const screenshot: RunArtifact = {
      id: "art_screen",
      workspaceId: "ws_1",
      runId: "run_1",
      attemptId: running.id,
      type: "SCREENSHOT",
      storageKey: "ws/ws_1/run/run_1/att/att_1/art_screen.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 42,
      metadataJson: null,
      createdAt: 1,
      expiresAt: 1_000,
    };
    const report: RunArtifact = {
      ...screenshot,
      id: "art_report",
      attemptId: null,
      type: "MARKDOWN_REPORT",
      storageKey: "ws/ws_1/run/run_1/art_report.md",
      mimeType: "text/markdown",
      createdAt: 2,
      expiresAt: 2_000,
    };
    await artifacts.insert(screenshot);
    await artifacts.insert(report);
    await expect(artifacts.findById(screenshot.id)).resolves.toEqual(screenshot);
    await expect(artifacts.listForAttempt(running.id)).resolves.toEqual([
      screenshot,
    ]);
    await expect(artifacts.listForRun("run_1")).resolves.toEqual([
      screenshot,
      report,
    ]);
    await expect(artifacts.findReportForRun("run_1")).resolves.toEqual(report);
    await expect(artifacts.listExpired(1_000, 10)).resolves.toEqual([
      screenshot,
    ]);
    await expect(
      artifacts.insert({ ...report, id: "art_duplicate" }),
    ).rejects.toThrow();
    await artifacts.deleteByIds([screenshot.id, "missing"]);
    await expect(artifacts.findById(screenshot.id)).resolves.toBeNull();
    await steps.deleteForAttempt(running.id);
    await expect(steps.listForAttempt(running.id)).resolves.toEqual([]);
  });

  it("claims queued attempts optimistically and starts run state atomically", async () => {
    const runs = new D1RunRepo(testEnv().DB);
    const attempts = new D1AttemptRepo(testEnv().DB);
    const queuedRun = testRun({
      id: "run_claim",
      testId: null,
      status: "QUEUED",
      createdAt: 100,
    });
    const queuedAttempt: TestAttempt = {
      ...attempt("att_claim"),
      testRunId: queuedRun.id,
      status: "QUEUED",
      retryDelaySeconds: 0,
      queuedAt: 100,
      startedAt: null,
      finishedAt: null,
      durationMs: null,
    };
    await runs.insert(queuedRun);
    await attempts.insert(queuedAttempt);

    await expect(runs.findByIdForExecution(queuedRun.id)).resolves.toEqual(
      queuedRun,
    );
    await expect(attempts.claimQueued(queuedAttempt.id, 500)).resolves.toBe(
      true,
    );
    await expect(attempts.claimQueued(queuedAttempt.id, 501)).resolves.toBe(
      false,
    );
    await expect(
      attempts.markRunning(
        queuedAttempt.id,
        queuedRun.id,
        0,
        600,
        "ue_claim",
      ),
    ).resolves.toBe(true);
    await runs.setAttemptCount(queuedRun.id, 1);
    await expect(attempts.findById(queuedAttempt.id)).resolves.toMatchObject({
      status: "RUNNING",
      startedAt: 600,
    });
    await expect(runs.findByIdForExecution(queuedRun.id)).resolves.toMatchObject({
      status: "RUNNING",
      startedAt: 600,
      usageEventId: "ue_claim",
      attemptCount: 1,
    });
    await expect(
      attempts.markRunning(
        queuedAttempt.id,
        queuedRun.id,
        0,
        700,
        "ue_other",
      ),
    ).resolves.toBe(false);
    await expect(runs.findByIdForExecution(queuedRun.id)).resolves.toMatchObject({
      startedAt: 600,
      usageEventId: "ue_claim",
    });
  });
});
