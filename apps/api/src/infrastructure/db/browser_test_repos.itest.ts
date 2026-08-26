import type {
  BrowserTest,
  RunArtifact,
  RunSnapshot,
  RunStatus,
  RunStep,
  TestAttempt,
  TestRun,
} from "../../domain/browser_tests/types";
import type { UsageEvent } from "../../domain/billing/types";
import { freshDb, testEnv } from "../../test/helpers";
import { D1ArtifactRepo } from "./artifact_repo";
import { D1AttemptRepo } from "./attempt_repo";
import { D1BrowserTestRepo } from "./browser_test_repo";
import { D1RunRepo } from "./run_repo";
import { D1StepRepo } from "./step_repo";
import { D1UsageEventRepo } from "./usage_event_repo";

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
    actionAuthorizations: [],
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
    inputTokens: 100,
    outputTokens: 23,
    modelName: "gpt-5-mini",
    runnerVersion: "runner-test",
    runnerKind: "fallback",
    systemErrorCode: "WORKER_LOST",
    createdAt: 100,
  };
}

function runUsage(
  run: TestRun,
  id: string,
  occurredAt: number,
): UsageEvent {
  return {
    id,
    workspaceId: run.workspaceId,
    testRunId: run.id,
    type: "BROWSER_RUN",
    quantity: 1,
    billable: true,
    idempotencyKey: `run:${run.id}`,
    occurredAt,
    reversedAt: null,
    createdAt: occurredAt,
  };
}

describe("D1 browser test repositories", () => {
  beforeEach(freshDb);

  it("atomically consumes exact action uses and rejects an inflated ledger", async () => {
    const database = testEnv().DB;
    const runs = new D1RunRepo(database);
    const scope = {
      kind: "HTTP" as const,
      method: "POST" as const,
      origin: "https://example.com",
      path: "/orders",
      maxUses: 1,
    };
    const authorized = testRun({
      id: "run_action_scope",
      testId: null,
      status: "RUNNING",
      createdAt: 100,
    });
    authorized.snapshot.irreversibleAuthorization = {
      version: 2,
      runId: authorized.id,
      workspaceId: authorized.workspaceId,
      originalInstructionsSha256: "digest",
      testDataAttested: true,
      approvedByUserId: "usr_1",
      approvedAt: 100,
      scopes: [scope],
      signature: "signature",
    };
    authorized.actionAuthorizations = [{ scope, remainingUses: 1 }];
    await runs.insert(authorized);

    const action = {
      kind: "HTTP" as const,
      method: "POST" as const,
      origin: "https://example.com",
      path: "/orders",
    };
    const raced = await Promise.all([
      runs.consumeActionAuthorization(authorized.id, action),
      runs.consumeActionAuthorization(authorized.id, action),
    ]);
    expect(raced.filter(Boolean)).toHaveLength(1);

    await database
      .prepare(
        "UPDATE test_runs SET action_authorizations_json = ? WHERE id = ?",
      )
      .bind(
        JSON.stringify([{ scope, remainingUses: scope.maxUses + 1 }]),
        authorized.id,
      )
      .run();
    await expect(
      runs.consumeActionAuthorization(authorized.id, action),
    ).resolves.toBe(false);
  });

  it("lists the recent runs per test oldest first, capped per test", async () => {
    const tests = new D1BrowserTestRepo(testEnv().DB);
    const runs = new D1RunRepo(testEnv().DB);
    await tests.insert(browserTest("bt_a", 500, "ws_1", 1));
    await tests.insert(browserTest("bt_b", 500, "ws_1", 2));
    await tests.insert(browserTest("bt_other", 500, "ws_2", 3));
    await runs.insert(testRun({ id: "run_a1", testId: "bt_a", status: "PASSED", createdAt: 100 }));
    await runs.insert(testRun({ id: "run_a2", testId: "bt_a", status: "FAILED", createdAt: 200 }));
    await runs.insert(testRun({ id: "run_a3", testId: "bt_a", status: "PASSED", createdAt: 300 }));
    await runs.insert(testRun({ id: "run_a4", testId: "bt_a", status: "RUNNING", createdAt: 400 }));
    await runs.insert(testRun({ id: "run_b1", testId: "bt_b", status: "TIMEOUT", createdAt: 150 }));
    await runs.insert(
      testRun({ id: "run_o1", testId: "bt_other", status: "PASSED", createdAt: 160, workspaceId: "ws_2" }),
    );

    const recent = await runs.recentRunsPerTest("ws_1", 3);
    expect(recent.get("bt_a")).toEqual([
      { id: "run_a2", status: "FAILED", finishedAt: 210 },
      { id: "run_a3", status: "PASSED", finishedAt: 310 },
      { id: "run_a4", status: "RUNNING", finishedAt: null },
    ]);
    expect(recent.get("bt_b")).toEqual([{ id: "run_b1", status: "TIMEOUT", finishedAt: 160 }]);
    expect(recent.has("bt_other")).toBe(false);
    expect(await runs.recentRunsPerTest("ws_empty", 3)).toEqual(new Map());
    expect(await runs.recentRunsPerTest("ws_1", 3, ["bt_b"])).toEqual(
      new Map([
        ["bt_b", [{ id: "run_b1", status: "TIMEOUT", finishedAt: 160 }]],
      ]),
    );
    expect(await runs.recentRunsPerTest("ws_1", 3, [])).toEqual(new Map());
  });

  it("round-trips tests, channels, soft deletion, and optimistic due claims", async () => {
    const repo = new D1BrowserTestRepo(testEnv().DB);
    const due = browserTest("bt_due", 500, "ws_1", 1);
    due.allowedDomains = ["checkout.example.net"];
    due.writableDomains = ["checkout.example.net"];
    const future = browserTest("bt_future", 5_000, "ws_1", 2);
    const other = browserTest("bt_other", 5_000, "ws_2", 3);
    await repo.insert(due);
    await repo.insert(future);
    await repo.insert(other);
    await repo.update(
      due.id,
      {
        name: "Renamed",
        allowedDomains: ["*.login.example.org"],
        writableDomains: ["auth.login.example.org"],
        device: "MOBILE",
        notifyOnRecovery: false,
        updatedBy: "usr_2",
      },
      10,
    );
    await expect(repo.findById("ws_1", due.id)).resolves.toMatchObject({
      name: "Renamed",
      allowedDomains: ["*.login.example.org"],
      writableDomains: ["auth.login.example.org"],
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

  it("never treats the retired global write flag as execution authority", async () => {
    const repo = new D1BrowserTestRepo(testEnv().DB);
    const legacy = browserTest("bt_legacy_write_flag", 5_000);
    await repo.insert(legacy);
    await testEnv().DB.prepare(
      `UPDATE browser_tests
       SET allow_reversible_writes = 1, writable_domains_json = '[]'
       WHERE id = ?`,
    )
      .bind(legacy.id)
      .run();

    await expect(repo.findById("ws_1", legacy.id)).resolves.toMatchObject({
      writableDomains: [],
    });
    expect(await repo.findById("ws_1", legacy.id)).not.toHaveProperty(
      "allowReversibleWrites",
    );
  });

  it("pages tests by created_at and id and batches channel links within the workspace", async () => {
    const repo = new D1BrowserTestRepo(testEnv().DB);
    for (const test of [
      browserTest("bt_old", 500, "ws_1", 10),
      browserTest("bt_tie_b", 500, "ws_1", 20),
      browserTest("bt_tie_c", 500, "ws_1", 20),
      browserTest("bt_other", 500, "ws_2", 30),
    ]) {
      await repo.insert(test);
    }
    await repo.setChannels("bt_tie_c", ["ch_2", "ch_1"]);
    await repo.setChannels("bt_tie_b", ["ch_3"]);

    const first = await repo.listPage("ws_1", null, 2);
    expect(first.map(({ id }) => id)).toEqual(["bt_tie_c", "bt_tie_b"]);
    const last = first.at(-1);
    const second = await repo.listPage(
      "ws_1",
      last === undefined ? null : { createdAt: last.createdAt, id: last.id },
      2,
    );
    expect(second.map(({ id }) => id)).toEqual(["bt_old"]);
    await expect(
      repo.getChannelIdsForTests("ws_1", ["bt_tie_c", "bt_tie_b", "bt_other"]),
    ).resolves.toEqual(
      new Map([
        ["bt_tie_c", ["ch_1", "ch_2"]],
        ["bt_tie_b", ["ch_3"]],
        ["bt_other", []],
      ]),
    );
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
      runs.scheduledOccurrenceExists("bt_1", 100),
    ).resolves.toBe(true);
    await expect(
      runs.scheduledOccurrenceExists("bt_1", 999),
    ).resolves.toBe(false);
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
    expect(await runs.lastRunSummaryPerTest("ws_1", ["bt_missing"])).toEqual(
      new Map(),
    );
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

  it("lists externally claimable attempts for the fallback runner", async () => {
    const runs = new D1RunRepo(testEnv().DB);
    const attempts = new D1AttemptRepo(testEnv().DB);
    await runs.insert(
      testRun({ id: "run_old", testId: null, status: "QUEUED", createdAt: 100 }),
    );
    await runs.insert(
      testRun({ id: "run_fresh", testId: null, status: "QUEUED", createdAt: 500 }),
    );
    await runs.insert(
      testRun({ id: "run_done", testId: null, status: "PASSED", createdAt: 100 }),
    );
    await runs.insert(
      testRun({
        id: "run_abandoned",
        testId: null,
        status: "RUNNING",
        createdAt: 40,
      }),
    );
    const queued = (id: string, runId: string, queuedAt: number): TestAttempt => ({
      ...attempt(id),
      testRunId: runId,
      status: "QUEUED",
      queuedAt,
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      systemErrorCode: null,
    });
    await attempts.insert(queued("att_old", "run_old", 100));
    await attempts.insert(queued("att_fresh", "run_fresh", 500));
    await attempts.insert(queued("att_done", "run_done", 100));
    await attempts.insert({
      ...queued("att_abandoned", "run_abandoned", 40),
      status: "RUNNING",
      startedAt: 50,
    });

    const ids = async (
      queuedBefore: number,
      abandonedBefore: number,
      limit: number,
    ) =>
      (
        await attempts.listExternallyClaimable(
          queuedBefore,
          abandonedBefore,
          limit,
        )
      ).map((entry) => entry.id);

    await expect(ids(250, 60, 5)).resolves.toEqual(["att_abandoned", "att_old"]);
    await expect(ids(250, 50, 5)).resolves.toEqual(["att_old"]);
    await expect(ids(99, 50, 5)).resolves.toEqual([]);
    await expect(ids(600, 60, 1)).resolves.toEqual(["att_abandoned"]);
    await expect(ids(600, 60, 5)).resolves.toEqual([
      "att_abandoned",
      "att_old",
      "att_fresh",
    ]);

    const unclaimed = async (queuedBefore: number) =>
      (await attempts.listUnclaimed(queuedBefore)).map((entry) => entry.id);
    await expect(unclaimed(600)).resolves.toEqual(["att_old", "att_fresh"]);
    await expect(unclaimed(101)).resolves.toEqual(["att_old"]);
    await expect(unclaimed(100)).resolves.toEqual([]);
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
      inputTokens: null,
      outputTokens: null,
      modelName: null,
      runnerVersion: null,
      runnerKind: null,
      systemErrorCode: null,
    });
    await attempts.update(running.id, {
      status: "STARTING",
      startedAt: 600,
      summary: "new summary",
      inputTokens: 5,
      outputTokens: 6,
      runnerKind: "primary",
    });
    await expect(attempts.listForRun("run_1")).resolves.toEqual([
      expect.objectContaining({
        status: "STARTING",
        startedAt: 600,
        summary: "new summary",
        inputTokens: 5,
        outputTokens: 6,
        runnerKind: "primary",
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
        runUsage(queuedRun, "ue_claim", 600),
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
        runUsage(queuedRun, "ue_other", 700),
      ),
    ).resolves.toBe(false);
    await expect(runs.findByIdForExecution(queuedRun.id)).resolves.toMatchObject({
      startedAt: 600,
      usageEventId: "ue_claim",
    });
  });

  it("records which runner worker claimed the attempt", async () => {
    const database = testEnv().DB;
    const runs = new D1RunRepo(database);
    const attempts = new D1AttemptRepo(database);
    const queuedRun = testRun({
      id: "run_claim_worker",
      testId: null,
      status: "QUEUED",
      createdAt: 1_000,
    });
    const queuedAttempt: TestAttempt = {
      ...attempt("att_claim_worker"),
      testRunId: queuedRun.id,
      status: "QUEUED",
      retryDelaySeconds: 0,
      queuedAt: 1_000,
      startedAt: null,
      finishedAt: null,
      durationMs: null,
    };
    const claimedBy = async (): Promise<string | null> =>
      (
        await database
          .prepare("SELECT claimed_by_runner_id FROM test_attempts WHERE id = ?")
          .bind(queuedAttempt.id)
          .first<{ claimed_by_runner_id: string | null }>()
      )?.claimed_by_runner_id ?? null;
    await runs.insert(queuedRun);
    await attempts.insert(queuedAttempt);

    await expect(
      attempts.claimQueued(
        queuedAttempt.id,
        2_000,
        "delivery-1",
        "vps-fallback",
      ),
    ).resolves.toBe(true);
    await expect(claimedBy()).resolves.toBe("vps-fallback");

    await attempts.resetForInfraRetry(queuedAttempt.id, 3_000);
    await expect(claimedBy()).resolves.toBeNull();
  });

  it("deduplicates concurrent attempt starts into one linked usage event", async () => {
    const database = testEnv().DB;
    const runs = new D1RunRepo(database);
    const firstWorker = new D1AttemptRepo(database);
    const secondWorker = new D1AttemptRepo(database);
    const queuedRun = testRun({
      id: "run_start_race",
      testId: null,
      status: "QUEUED",
      createdAt: 100,
    });
    const queuedAttempt: TestAttempt = {
      ...attempt("att_start_race"),
      testRunId: queuedRun.id,
      status: "QUEUED",
      retryDelaySeconds: 0,
      queuedAt: 100,
      startedAt: null,
      finishedAt: null,
      durationMs: null,
    };
    await runs.insert(queuedRun);
    await firstWorker.insert(queuedAttempt);
    await firstWorker.claimQueued(queuedAttempt.id, 500);

    const results = await Promise.all([
      firstWorker.markRunning(
        queuedAttempt.id,
        queuedRun.id,
        0,
        600,
        runUsage(queuedRun, "ue_start_race_a", 600),
      ),
      secondWorker.markRunning(
        queuedAttempt.id,
        queuedRun.id,
        0,
        601,
        runUsage(queuedRun, "ue_start_race_b", 601),
      ),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    const usage = await database
      .prepare(
        `SELECT id, test_run_id
         FROM usage_events
         WHERE test_run_id = ?`,
      )
      .bind(queuedRun.id)
      .all<{ id: string; test_run_id: string }>();
    expect(usage.results).toHaveLength(1);
    const usageEventId = usage.results[0]?.id;
    expect(usageEventId).toMatch(/^ue_start_race_[ab]$/u);
    await expect(runs.findByIdForExecution(queuedRun.id)).resolves.toMatchObject({
      status: "RUNNING",
      usageEventId,
    });
    await expect(firstWorker.findById(queuedAttempt.id)).resolves.toMatchObject({
      status: "RUNNING",
    });
  });

  it("recovers and links a usage event left by an earlier delivery", async () => {
    const database = testEnv().DB;
    const runs = new D1RunRepo(database);
    const attempts = new D1AttemptRepo(database);
    const usageEvents = new D1UsageEventRepo(database);
    const queuedRun = testRun({
      id: "run_start_recovery",
      testId: null,
      status: "QUEUED",
      createdAt: 100,
    });
    const queuedAttempt: TestAttempt = {
      ...attempt("att_start_recovery"),
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
    await usageEvents.insertIfAbsent(
      runUsage(queuedRun, "ue_start_existing", 450),
    );
    await attempts.claimQueued(queuedAttempt.id, 500);

    await expect(
      attempts.markRunning(
        queuedAttempt.id,
        queuedRun.id,
        0,
        600,
        runUsage(queuedRun, "ue_start_unused_candidate", 600),
      ),
    ).resolves.toBe(true);

    await expect(runs.findByIdForExecution(queuedRun.id)).resolves.toMatchObject({
      status: "RUNNING",
      usageEventId: "ue_start_existing",
    });
    await expect(usageEvents.findByRunId(queuedRun.id)).resolves.toMatchObject({
      id: "ue_start_existing",
      occurredAt: 450,
    });
    const usageRows = await database
      .prepare("SELECT id FROM usage_events WHERE test_run_id = ?")
      .bind(queuedRun.id)
      .all();
    expect(usageRows.results).toEqual([{ id: "ue_start_existing" }]);
  });

  it("rolls back usage creation when the run transition fails", async () => {
    const database = testEnv().DB;
    const runs = new D1RunRepo(database);
    const attempts = new D1AttemptRepo(database);
    const queuedRun = testRun({
      id: "run_start_rollback",
      testId: null,
      status: "QUEUED",
      createdAt: 100,
    });
    const queuedAttempt: TestAttempt = {
      ...attempt("att_start_rollback"),
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
    await attempts.claimQueued(queuedAttempt.id, 500);
    await database
      .prepare(
        `CREATE TRIGGER reject_atomic_run_start
         BEFORE UPDATE OF status, usage_event_id ON test_runs
         WHEN NEW.id = 'run_start_rollback' AND NEW.status = 'RUNNING'
         BEGIN
           SELECT RAISE(ABORT, 'forced run transition failure');
         END`,
      )
      .run();

    try {
      await expect(
        attempts.markRunning(
          queuedAttempt.id,
          queuedRun.id,
          0,
          600,
          runUsage(queuedRun, "ue_start_rollback", 600),
        ),
      ).rejects.toThrow(/forced run transition failure/u);
    } finally {
      await database.prepare("DROP TRIGGER reject_atomic_run_start").run();
    }

    await expect(
      database
        .prepare("SELECT id FROM usage_events WHERE test_run_id = ?")
        .bind(queuedRun.id)
        .all(),
    ).resolves.toMatchObject({ results: [] });
    await expect(attempts.findById(queuedAttempt.id)).resolves.toMatchObject({
      status: "STARTING",
      startedAt: 500,
    });
    await expect(runs.findByIdForExecution(queuedRun.id)).resolves.toMatchObject({
      status: "QUEUED",
      startedAt: null,
      usageEventId: null,
    });
  });
});
