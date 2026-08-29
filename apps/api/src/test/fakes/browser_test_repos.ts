import type {
  ArtifactRepo,
  AttemptRepo,
  AttemptUpdate,
  BrowserTestRepo,
  BrowserTestUpdate,
  RunFinalize,
  RunIncidentOrder,
  RunRepo,
  StepRepo,
} from "../../domain/browser_tests/repo";
import type {
  BrowserTest,
  ClaimedBrowserTest,
  AttemptWithLatest,
  RunArtifact,
  RunStatus,
  RunStep,
  RunSummaryRow,
  RunTick,
  TestAttempt,
  TestRun,
} from "../../domain/browser_tests/types";
import type { UsageEvent } from "../../domain/billing/types";
import type { Cursor } from "../../shared/pagination";
import {
  actionMatchesScope,
  validActionAuthorizationState,
} from "../../domain/browser_tests/irreversible_authorization";

function copy<T>(value: T): T {
  return structuredClone(value);
}

export class FakeBrowserTestRepo implements BrowserTestRepo {
  readonly tests = new Map<string, BrowserTest>();
  readonly channels = new Map<string, string[]>();

  async insert(test: BrowserTest): Promise<void> {
    if (this.tests.has(test.id)) throw new Error("browser test constraint violation");
    this.tests.set(test.id, copy(test));
  }

  async findById(
    workspaceId: string,
    id: string,
  ): Promise<BrowserTest | null> {
    const test = this.tests.get(id);
    return test === undefined ||
      test.workspaceId !== workspaceId ||
      test.deletedAt !== null
      ? null
      : copy(test);
  }

  async findByIds(
    workspaceId: string,
    ids: string[],
  ): Promise<BrowserTest[]> {
    const wanted = new Set(ids);
    return [...this.tests.values()]
      .filter(
        (test) =>
          test.workspaceId === workspaceId &&
          test.deletedAt === null &&
          wanted.has(test.id),
      )
      .map(copy);
  }

  async list(workspaceId: string): Promise<BrowserTest[]> {
    return [...this.tests.values()]
      .filter(
        (test) => test.workspaceId === workspaceId && test.deletedAt === null,
      )
      .sort(
        (left, right) =>
          right.createdAt - left.createdAt || right.id.localeCompare(left.id),
      )
      .map(copy);
  }

  async listPage(
    workspaceId: string,
    cursor: Cursor | null | undefined,
    limit: number,
  ): Promise<BrowserTest[]> {
    return (await this.list(workspaceId))
      .filter(
        (test) =>
          cursor === null ||
          cursor === undefined ||
          test.createdAt < cursor.createdAt ||
          (test.createdAt === cursor.createdAt && test.id < cursor.id),
      )
      .slice(0, limit);
  }

  async update(
    id: string,
    changes: BrowserTestUpdate,
    at: number,
  ): Promise<void> {
    const test = this.tests.get(id);
    if (test !== undefined && test.deletedAt === null) {
      this.tests.set(id, { ...test, ...copy(changes), updatedAt: at });
    }
  }

  async softDelete(id: string, at: number): Promise<void> {
    const test = this.tests.get(id);
    if (test !== undefined && test.deletedAt === null) {
      this.tests.set(id, { ...test, deletedAt: at, updatedAt: at });
    }
  }

  async setNextRunAt(id: string, at: number): Promise<void> {
    const test = this.tests.get(id);
    if (test !== undefined && test.deletedAt === null) {
      this.tests.set(id, { ...test, nextRunAt: at });
    }
  }

  async claimDue(now: number, limit: number): Promise<ClaimedBrowserTest[]> {
    const due = [...this.tests.values()]
      .filter((test) => test.deletedAt === null && test.nextRunAt <= now)
      .sort(
        (left, right) =>
          left.nextRunAt - right.nextRunAt || left.id.localeCompare(right.id),
      )
      .slice(0, limit);
    return due.map((test) => {
      const scheduledFor = test.nextRunAt;
      const nextRunAt = now + test.intervalHours * 3_600_000;
      this.tests.set(test.id, { ...test, nextRunAt });
      return { ...copy(test), nextRunAt, scheduledFor };
    });
  }

  async setChannels(testId: string, channelIds: string[]): Promise<void> {
    this.channels.set(testId, [...new Set(channelIds)].sort());
  }

  async addChannelToAll(workspaceId: string, channelId: string): Promise<void> {
    for (const test of this.tests.values()) {
      if (test.workspaceId !== workspaceId || test.deletedAt !== null) continue;
      await this.setChannels(test.id, [...(this.channels.get(test.id) ?? []), channelId]);
    }
  }

  async getChannelIds(testId: string): Promise<string[]> {
    return [...(this.channels.get(testId) ?? [])];
  }

  async getChannelIdsForTests(
    workspaceId: string,
    testIds: string[],
  ): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    for (const testId of new Set(testIds)) {
      const test = this.tests.get(testId);
      result.set(
        testId,
        test?.workspaceId === workspaceId && test.deletedAt === null
          ? [...(this.channels.get(testId) ?? [])]
          : [],
      );
    }
    return result;
  }
}

export class FakeRunRepo implements RunRepo {
  readonly runs = new Map<string, TestRun>();
  readonly initialAttempts = new Map<string, TestAttempt>();

  async testsWithFinishedRuns(
    workspaceId: string,
    testIds: string[],
  ): Promise<Set<string>> {
    const wanted = new Set(testIds);
    const finished = new Set<string>();
    for (const run of this.runs.values()) {
      if (
        run.workspaceId === workspaceId &&
        run.finishedAt !== null &&
        run.browserTestId !== null &&
        wanted.has(run.browserTestId)
      ) {
        finished.add(run.browserTestId);
      }
    }
    return finished;
  }

  async insert(run: TestRun): Promise<void> {
    if (this.runs.has(run.id)) throw new Error("run constraint violation");
    if (
      run.browserTestId !== null &&
      (run.status === "QUEUED" || run.status === "RUNNING") &&
      [...this.runs.values()].some(
        (candidate) =>
          candidate.browserTestId === run.browserTestId &&
          (candidate.status === "QUEUED" || candidate.status === "RUNNING"),
      )
    ) {
      throw new Error("run active constraint violation");
    }
    if (
      run.browserTestId !== null &&
      run.scheduledFor !== null &&
      [...this.runs.values()].some(
        (candidate) =>
          candidate.browserTestId === run.browserTestId &&
          candidate.scheduledFor === run.scheduledFor,
      )
    ) {
      throw new Error("run occurrence constraint violation");
    }
    this.runs.set(run.id, copy(run));
  }

  async insertWithAttempt(
    run: TestRun,
    attempt: TestAttempt,
  ): Promise<void> {
    await this.insert(run);
    try {
      if (
        this.initialAttempts.has(attempt.id) ||
        [...this.initialAttempts.values()].some(
          (candidate) =>
            candidate.testRunId === attempt.testRunId &&
            candidate.attemptIndex === attempt.attemptIndex,
        )
      ) {
        throw new Error("attempt constraint violation");
      }
      this.initialAttempts.set(attempt.id, copy(attempt));
    } catch (error) {
      this.runs.delete(run.id);
      throw error;
    }
  }

  async findById(
    workspaceId: string,
    runId: string,
  ): Promise<TestRun | null> {
    const run = this.runs.get(runId);
    return run === undefined || run.workspaceId !== workspaceId
      ? null
      : copy(run);
  }

  async findByIdForExecution(runId: string): Promise<TestRun | null> {
    const run = this.runs.get(runId);
    return run === undefined ? null : copy(run);
  }

  async consumeActionAuthorization(
    runId: string,
    action: import("../../domain/browser_tests/types").IrreversibleActionRequest,
  ): Promise<boolean> {
    const run = this.runs.get(runId);
    if (run === undefined || run.status !== "RUNNING") return false;
    const state = structuredClone(run.actionAuthorizations ?? []);
    if (!validActionAuthorizationState(run.snapshot, state)) return false;
    const index = state.findIndex(
      (entry) =>
        entry.remainingUses > 0 && actionMatchesScope(action, entry.scope),
    );
    if (index < 0) return false;
    const current = state[index];
    if (current === undefined) return false;
    state[index] = {
      scope: current.scope,
      remainingUses: current.remainingUses - 1,
    };
    this.runs.set(runId, { ...run, actionAuthorizations: state });
    return true;
  }

  async listForTest(
    testId: string,
    cursor: Cursor | null | undefined,
    limit: number,
    statusFilter?: RunStatus,
  ): Promise<TestRun[]> {
    return [...this.runs.values()]
      .filter(
        (run) =>
          run.browserTestId === testId &&
          (statusFilter === undefined || run.status === statusFilter) &&
          (cursor === null ||
            cursor === undefined ||
            run.createdAt < cursor.createdAt ||
            (run.createdAt === cursor.createdAt && run.id < cursor.id)),
      )
      .sort(
        (left, right) =>
          right.createdAt - left.createdAt || right.id.localeCompare(left.id),
      )
      .slice(0, limit)
      .map(copy);
  }

  async updateStatus(
    runId: string,
    status: RunStatus,
    startedAt?: number,
  ): Promise<void> {
    const run = this.runs.get(runId);
    if (run !== undefined) {
      this.runs.set(runId, {
        ...run,
        status,
        startedAt: run.startedAt ?? startedAt ?? null,
      });
    }
  }

  async finalize(runId: string, changes: RunFinalize): Promise<void> {
    const run = this.runs.get(runId);
    if (run !== undefined) {
      this.runs.set(runId, {
        ...run,
        status: changes.status,
        finishedAt: changes.finishedAt,
        durationMs: changes.durationMs,
        attemptCount: changes.attemptCount,
        passedAfterRetry: changes.passedAfterRetry,
        billable: changes.billable,
        ...(changes.incidentId === undefined
          ? {}
          : { incidentId: changes.incidentId }),
      });
    }
  }

  async setAttemptCount(runId: string, attemptCount: number): Promise<void> {
    const run = this.runs.get(runId);
    if (run !== undefined) this.runs.set(runId, { ...run, attemptCount });
  }

  async setUsageEventId(runId: string, usageEventId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (run !== undefined) this.runs.set(runId, { ...run, usageEventId });
  }

  async setIncidentId(
    runId: string,
    incidentId: string | null,
  ): Promise<void> {
    const run = this.runs.get(runId);
    if (run !== undefined) this.runs.set(runId, { ...run, incidentId });
  }

  async hasLaterIncidentResult(order: RunIncidentOrder): Promise<boolean> {
    return [...this.runs.values()].some((run) => {
      if (
        run.browserTestId !== order.browserTestId ||
        run.source === "VALIDATION" ||
        run.finishedAt === null ||
        (run.status !== "PASSED" &&
          run.status !== "FAILED" &&
          run.status !== "TIMEOUT")
      ) {
        return false;
      }
      return (
        run.finishedAt > order.finishedAt ||
        (run.finishedAt === order.finishedAt && run.createdAt > order.createdAt) ||
        (run.finishedAt === order.finishedAt &&
          run.createdAt === order.createdAt &&
          run.id > order.runId)
      );
    });
  }

  async incrementInfraAttempts(runId: string): Promise<number> {
    const run = this.runs.get(runId);
    if (run === undefined) return 0;
    const infraAttempts = run.infraAttempts + 1;
    this.runs.set(runId, { ...run, infraAttempts });
    return infraAttempts;
  }

  async recentRunsPerTest(
    workspaceId: string,
    limit: number,
    testIds?: string[],
  ): Promise<Map<string, RunTick[]>> {
    const ticks = new Map<string, RunTick[]>();
    const selected = testIds === undefined ? null : new Set(testIds);
    const runs = [...this.runs.values()]
      .filter(
        (run) =>
          run.workspaceId === workspaceId &&
          run.browserTestId !== null &&
          (selected === null || selected.has(run.browserTestId)),
      )
      .sort(
        (left, right) =>
          right.createdAt - left.createdAt || right.id.localeCompare(left.id),
      );
    for (const run of runs) {
      const testId = run.browserTestId ?? "";
      const list = ticks.get(testId) ?? [];
      if (list.length >= limit) continue;
      list.unshift({ id: run.id, status: run.status, finishedAt: run.finishedAt });
      ticks.set(testId, list);
    }
    return ticks;
  }

  async lastRunSummaryPerTest(
    workspaceId: string,
    testIds?: string[],
  ): Promise<Map<string, RunSummaryRow>> {
    const summaries = new Map<string, RunSummaryRow>();
    const selected = testIds === undefined ? null : new Set(testIds);
    const finished = [...this.runs.values()]
      .filter(
        (run) =>
          run.workspaceId === workspaceId &&
          run.browserTestId !== null &&
          (selected === null || selected.has(run.browserTestId)) &&
          run.finishedAt !== null,
      )
      .sort(
        (left, right) =>
          right.createdAt - left.createdAt || right.id.localeCompare(left.id),
      );
    for (const run of finished) {
      if (run.browserTestId === null || summaries.has(run.browserTestId)) {
        continue;
      }
      summaries.set(run.browserTestId, {
        browserTestId: run.browserTestId,
        id: run.id,
        source: run.source,
        status: run.status,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        durationMs: run.durationMs,
        attemptCount: run.attemptCount,
        passedAfterRetry: run.passedAfterRetry,
        billable: run.billable,
        createdAt: run.createdAt,
      });
    }
    return summaries;
  }

  async activeRunExists(testId: string): Promise<boolean> {
    return [...this.runs.values()].some(
      (run) =>
        run.browserTestId === testId &&
        (run.status === "QUEUED" || run.status === "RUNNING"),
    );
  }

  async scheduledOccurrenceExists(
    testId: string,
    scheduledFor: number,
  ): Promise<boolean> {
    return [...this.runs.values()].some(
      (run) =>
        run.browserTestId === testId && run.scheduledFor === scheduledFor,
    );
  }

  async countRunning(workspaceId: string): Promise<number> {
    return [...this.runs.values()].filter(
      (run) => run.workspaceId === workspaceId && run.status === "RUNNING",
    ).length;
  }
}

export class FakeAttemptRepo implements AttemptRepo {
  readonly attempts = new Map<string, TestAttempt>();
  readonly runnerDeliveryIds = new Map<string, string>();
  readonly claimedBy = new Map<string, string | undefined>();
  readonly latest = new Map<
    string,
    Pick<AttemptWithLatest, "latestStep" | "latestScreenshot">
  >();

  constructor(
    private readonly runs?: FakeRunRepo,
    private readonly usageEvents?: { readonly events: Map<string, UsageEvent> },
  ) {}

  async insert(attempt: TestAttempt): Promise<void> {
    if (
      this.attempts.has(attempt.id) ||
      [...this.attempts.values()].some(
        (candidate) =>
          candidate.testRunId === attempt.testRunId &&
          candidate.attemptIndex === attempt.attemptIndex,
      )
    ) {
      throw new Error("attempt constraint violation");
    }
    this.attempts.set(attempt.id, copy(attempt));
  }

  async findById(id: string): Promise<TestAttempt | null> {
    const attempt = this.attempts.get(id);
    return attempt === undefined ? null : copy(attempt);
  }

  async claimQueued(
    id: string,
    claimedAt: number,
    runnerDeliveryId?: string,
    claimedByRunnerId?: string,
  ): Promise<boolean> {
    const attempt = this.attempts.get(id);
    if (
      attempt === undefined ||
      attempt.status !== "QUEUED" ||
      attempt.queuedAt > claimedAt
    ) return false;
    this.attempts.set(id, {
      ...attempt,
      status: "STARTING",
      startedAt: claimedAt,
    });
    if (runnerDeliveryId !== undefined) {
      this.runnerDeliveryIds.set(id, runnerDeliveryId);
    }
    this.claimedBy.set(id, claimedByRunnerId);
    return true;
  }

  async isRunnerDeliveryOwner(
    id: string,
    runnerDeliveryId: string,
  ): Promise<boolean> {
    return this.runnerDeliveryIds.get(id) === runnerDeliveryId;
  }

  async markRunning(
    id: string,
    runId: string,
    attemptIndex: number,
    startedAt: number,
    usageEvent: UsageEvent,
  ): Promise<boolean> {
    const attempt = this.attempts.get(id);
    const runs = this.runs;
    const run = runs?.runs.get(runId);
    if (
      attempt === undefined ||
      runs === undefined ||
      run === undefined ||
      this.usageEvents === undefined ||
      attempt.status !== "STARTING" ||
      attempt.testRunId !== runId ||
      attempt.attemptIndex !== attemptIndex ||
      (run.status !== "QUEUED" && run.status !== "RUNNING") ||
      usageEvent.testRunId !== runId ||
      usageEvent.workspaceId !== run.workspaceId
    ) {
      return false;
    }

    const existing = [...this.usageEvents.events.values()].find(
      (candidate) => candidate.testRunId === runId,
    );
    const selected = existing ?? usageEvent;
    if (
      selected.workspaceId !== run.workspaceId ||
      selected.idempotencyKey !== usageEvent.idempotencyKey ||
      (run.usageEventId !== null && run.usageEventId !== selected.id) ||
      (existing === undefined &&
        (this.usageEvents.events.has(usageEvent.id) ||
          [...this.usageEvents.events.values()].some(
            (candidate) =>
              candidate.idempotencyKey === usageEvent.idempotencyKey,
          )))
    ) {
      return false;
    }

    if (existing === undefined) {
      this.usageEvents.events.set(usageEvent.id, copy(usageEvent));
    }
    this.attempts.set(id, { ...attempt, status: "RUNNING", startedAt });
    runs.runs.set(runId, {
      ...run,
      status: "RUNNING",
      startedAt: run.startedAt ?? startedAt,
      usageEventId: selected.id,
    });
    return true;
  }

  async findByRunAndIndex(
    runId: string,
    attemptIndex: number,
  ): Promise<TestAttempt | null> {
    const attempt = [...this.attempts.values()].find(
      (candidate) =>
        candidate.testRunId === runId &&
        candidate.attemptIndex === attemptIndex,
    );
    return attempt === undefined ? null : copy(attempt);
  }

  async listForRun(runId: string): Promise<TestAttempt[]> {
    return [...this.attempts.values()]
      .filter((attempt) => attempt.testRunId === runId)
      .sort((left, right) => left.attemptIndex - right.attemptIndex)
      .map(copy);
  }

  async listForRunWithLatest(runId: string): Promise<AttemptWithLatest[]> {
    return (await this.listForRun(runId)).map((attempt) => ({
      attempt,
      latestStep: copy(this.latest.get(attempt.id)?.latestStep ?? null),
      latestScreenshot: copy(
        this.latest.get(attempt.id)?.latestScreenshot ?? null,
      ),
    }));
  }

  async update(id: string, fields: AttemptUpdate): Promise<void> {
    const attempt = this.attempts.get(id);
    if (attempt !== undefined) {
      this.attempts.set(id, { ...attempt, ...copy(fields) });
    }
  }

  async resetForInfraRetry(id: string, queuedAt: number): Promise<void> {
    this.runnerDeliveryIds.delete(id);
    this.claimedBy.delete(id);
    const attempt = this.attempts.get(id);
    if (attempt !== undefined) {
      this.attempts.set(id, {
        ...attempt,
        status: "QUEUED",
        queuedAt,
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
    }
  }

  async listUnclaimed(queuedBefore: number): Promise<TestAttempt[]> {
    const runs = this.runs;
    if (runs === undefined) return [];
    return [...this.attempts.values()]
      .filter((attempt) => {
        const run = runs.runs.get(attempt.testRunId);
        if (
          run === undefined ||
          (run.status !== "QUEUED" && run.status !== "RUNNING")
        ) {
          return false;
        }
        return attempt.status === "QUEUED" && attempt.queuedAt < queuedBefore;
      })
      .sort(
        (left, right) =>
          left.queuedAt - right.queuedAt || (left.id < right.id ? -1 : 1),
      );
  }

  async listStale(before: number): Promise<TestAttempt[]> {
    return [...this.attempts.values()]
      .filter(
        (attempt) =>
          (attempt.status === "STARTING" || attempt.status === "RUNNING") &&
          attempt.startedAt !== null &&
          attempt.startedAt < before,
      )
      .sort(
        (left, right) =>
          (left.startedAt ?? 0) - (right.startedAt ?? 0) ||
          left.id.localeCompare(right.id),
      )
      .map(copy);
  }

  async listExternallyClaimable(
    queuedBefore: number,
    abandonedBefore: number,
    limit: number,
  ): Promise<TestAttempt[]> {
    const runs = this.runs;
    if (runs === undefined) return [];
    return [...this.attempts.values()]
      .filter((attempt) => {
        const run = runs.runs.get(attempt.testRunId);
        if (run === undefined || (run.status !== "QUEUED" && run.status !== "RUNNING")) {
          return false;
        }
        if (attempt.status === "QUEUED") return attempt.queuedAt <= queuedBefore;
        return (
          (attempt.status === "STARTING" || attempt.status === "RUNNING") &&
          attempt.startedAt !== null &&
          attempt.startedAt < abandonedBefore
        );
      })
      .sort(
        (left, right) =>
          left.queuedAt - right.queuedAt || left.id.localeCompare(right.id),
      )
      .slice(0, limit)
      .map(copy);
  }
}

export class FakeStepRepo implements StepRepo {
  readonly steps = new Map<string, RunStep>();

  async insertMany(steps: RunStep[]): Promise<void> {
    for (const step of steps) {
      if (
        this.steps.has(step.id) ||
        [...this.steps.values()].some(
          (candidate) =>
            candidate.attemptId === step.attemptId &&
            candidate.sequence === step.sequence,
        )
      ) {
        throw new Error("step constraint violation");
      }
      this.steps.set(step.id, copy(step));
    }
  }

  async listForAttempt(attemptId: string): Promise<RunStep[]> {
    return [...this.steps.values()]
      .filter((step) => step.attemptId === attemptId)
      .sort((left, right) => left.sequence - right.sequence)
      .map(copy);
  }

  async deleteForAttempt(attemptId: string): Promise<void> {
    for (const [id, step] of this.steps) {
      if (step.attemptId === attemptId) this.steps.delete(id);
    }
  }
}

export class FakeArtifactRepo implements ArtifactRepo {
  readonly artifacts = new Map<string, RunArtifact>();

  async insert(artifact: RunArtifact): Promise<void> {
    if (
      this.artifacts.has(artifact.id) ||
      [...this.artifacts.values()].some(
        (candidate) =>
          candidate.storageKey === artifact.storageKey ||
          (artifact.type === "MARKDOWN_REPORT" &&
            candidate.type === "MARKDOWN_REPORT" &&
            candidate.runId === artifact.runId),
      )
    ) {
      throw new Error("artifact constraint violation");
    }
    this.artifacts.set(artifact.id, copy(artifact));
  }

  async findById(id: string): Promise<RunArtifact | null> {
    const artifact = this.artifacts.get(id);
    return artifact === undefined ? null : copy(artifact);
  }

  async findByIds(ids: string[]): Promise<RunArtifact[]> {
    return [...new Set(ids)]
      .map((id) => this.artifacts.get(id))
      .filter((artifact): artifact is RunArtifact => artifact !== undefined)
      .map(copy);
  }

  async listForAttempt(attemptId: string): Promise<RunArtifact[]> {
    return this.sorted((artifact) => artifact.attemptId === attemptId);
  }

  async listForRun(runId: string): Promise<RunArtifact[]> {
    return this.sorted((artifact) => artifact.runId === runId);
  }

  async findReportForRun(runId: string): Promise<RunArtifact | null> {
    const report = [...this.artifacts.values()]
      .filter(
        (artifact) =>
          artifact.runId === runId && artifact.type === "MARKDOWN_REPORT",
      )
      .sort(
        (left, right) =>
          right.createdAt - left.createdAt || right.id.localeCompare(left.id),
      )[0];
    return report === undefined ? null : copy(report);
  }

  async listExpired(before: number, limit: number): Promise<RunArtifact[]> {
    return [...this.artifacts.values()]
      .filter((artifact) => artifact.expiresAt <= before)
      .sort(
        (left, right) =>
          left.expiresAt - right.expiresAt || left.id.localeCompare(right.id),
      )
      .slice(0, limit)
      .map(copy);
  }

  async deleteByIds(ids: string[]): Promise<void> {
    for (const id of ids) this.artifacts.delete(id);
  }

  private sorted(predicate: (artifact: RunArtifact) => boolean): RunArtifact[] {
    return [...this.artifacts.values()]
      .filter(predicate)
      .sort(
        (left, right) =>
          left.createdAt - right.createdAt || left.id.localeCompare(right.id),
      )
      .map(copy);
  }
}
