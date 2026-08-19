import type {
  ArtifactRepo,
  AttemptRepo,
  AttemptUpdate,
  BrowserTestRepo,
  BrowserTestUpdate,
  RunFinalize,
  RunRepo,
  StepRepo,
} from "../../domain/browser_tests/repo";
import type {
  BrowserTest,
  ClaimedBrowserTest,
  RunArtifact,
  RunStatus,
  RunStep,
  RunSummaryRow,
  TestAttempt,
  TestRun,
} from "../../domain/browser_tests/types";
import type { Cursor } from "../../shared/pagination";

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

  async getChannelIds(testId: string): Promise<string[]> {
    return [...(this.channels.get(testId) ?? [])];
  }
}

export class FakeRunRepo implements RunRepo {
  readonly runs = new Map<string, TestRun>();
  readonly initialAttempts = new Map<string, TestAttempt>();

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

  async incrementInfraAttempts(runId: string): Promise<number> {
    const run = this.runs.get(runId);
    if (run === undefined) return 0;
    const infraAttempts = run.infraAttempts + 1;
    this.runs.set(runId, { ...run, infraAttempts });
    return infraAttempts;
  }

  async lastRunSummaryPerTest(
    workspaceId: string,
  ): Promise<Map<string, RunSummaryRow>> {
    const summaries = new Map<string, RunSummaryRow>();
    const finished = [...this.runs.values()]
      .filter(
        (run) =>
          run.workspaceId === workspaceId &&
          run.browserTestId !== null &&
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

  async countRunning(workspaceId: string): Promise<number> {
    return [...this.runs.values()].filter(
      (run) => run.workspaceId === workspaceId && run.status === "RUNNING",
    ).length;
  }
}

export class FakeAttemptRepo implements AttemptRepo {
  readonly attempts = new Map<string, TestAttempt>();

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

  async update(id: string, fields: AttemptUpdate): Promise<void> {
    const attempt = this.attempts.get(id);
    if (attempt !== undefined) {
      this.attempts.set(id, { ...attempt, ...copy(fields) });
    }
  }

  async resetForInfraRetry(id: string, queuedAt: number): Promise<void> {
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
        modelName: null,
        runnerVersion: null,
        systemErrorCode: null,
      });
    }
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
        (candidate) => candidate.storageKey === artifact.storageKey,
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
