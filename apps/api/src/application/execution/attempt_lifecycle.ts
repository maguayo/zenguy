import type { RecordRunUsage } from "../billing/record_run_usage";
import type { ReverseRunUsage } from "../billing/reverse_run_usage";
import type {
  ArtifactRepo,
  AttemptRepo,
  BrowserTestRepo,
  RunRepo,
  StepRepo,
} from "../../domain/browser_tests/repo";
import type { RunFinalizedHandler } from "../../domain/browser_tests/ports";
import {
  computeRunDuration,
  decideAfterAttempt,
} from "../../domain/browser_tests/run_rules";
import type {
  TestAttempt,
  TestRun,
} from "../../domain/browser_tests/types";
import type { AttemptMessage } from "../../domain/queues";
import type { WorkspaceRepo } from "../../domain/workspaces/repo";
import type { ArtifactStorage } from "../../infrastructure/storage/artifacts";
import type { Clock } from "../../shared/clock";
import { ATTEMPT_TIMEOUT_MS } from "../../shared/constants";
import type { IdGenerator } from "../../shared/ids";
import { platformAlert } from "../../shared/log";

const WORKER_LOST_GRACE_MS = 120_000;

export interface AttemptOutcome {
  status: "PASSED" | "FAILED" | "TIMEOUT" | "SYSTEM_ERROR";
  summary?: string;
  expectedResult?: string;
  actualResult?: string;
  failureReason?: string;
  systemErrorCode?: string;
  tokenUsage?: number;
  modelName?: string;
  runnerVersion?: string;
  visitedUrls: string[];
  consoleErrors: unknown[];
  networkErrors: unknown[];
}

export interface AttemptLifecycleDependencies {
  runs: RunRepo;
  attempts: AttemptRepo;
  steps: StepRepo;
  artifacts: ArtifactRepo;
  tests: BrowserTestRepo;
  workspaces: WorkspaceRepo;
  storage: Pick<ArtifactStorage, "delete">;
  recordUsage: Pick<RecordRunUsage, "execute">;
  reverseUsage: Pick<ReverseRunUsage, "execute">;
  queue: Pick<Queue<AttemptMessage>, "send">;
  clock: Clock;
  ids: IdGenerator;
  runFinalizedHandler: RunFinalizedHandler;
}

function isRunTerminal(run: TestRun): boolean {
  return (
    run.status === "PASSED" ||
    run.status === "FAILED" ||
    run.status === "TIMEOUT" ||
    run.status === "SYSTEM_ERROR"
  );
}

function attemptDuration(attempt: TestAttempt, finishedAt: number): number {
  return Math.max(0, finishedAt - (attempt.startedAt ?? attempt.queuedAt));
}

function queuedAttempt(input: {
  id: string;
  runId: string;
  attemptIndex: number;
  retryDelaySeconds: number;
  now: number;
}): TestAttempt {
  return {
    id: input.id,
    testRunId: input.runId,
    attemptIndex: input.attemptIndex,
    status: "QUEUED",
    retryDelaySeconds: input.retryDelaySeconds,
    queuedAt: input.now,
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
    createdAt: input.now,
  };
}

export class AttemptLifecycle {
  constructor(private readonly dependencies: AttemptLifecycleDependencies) {}

  async claim(message: AttemptMessage): Promise<"execute" | "skip"> {
    const [run, attempt] = await Promise.all([
      this.dependencies.runs.findByIdForExecution(message.runId),
      this.dependencies.attempts.findById(message.attemptId),
    ]);
    if (
      run === null ||
      attempt === null ||
      attempt.testRunId !== message.runId ||
      attempt.attemptIndex !== message.attemptIndex
    ) {
      platformAlert("attempt_claim_missing", {
        runId: message.runId,
        attemptId: message.attemptId,
      });
      return "skip";
    }
    if (isRunTerminal(run)) return "skip";
    const [workspace, test] = await Promise.all([
      this.dependencies.workspaces.findById(run.workspaceId),
      run.browserTestId === null
        ? Promise.resolve(null)
        : this.dependencies.tests.findById(run.workspaceId, run.browserTestId),
    ]);
    if (
      workspace === null ||
      (run.browserTestId !== null && test === null)
    ) {
      await this.cancelDeletedRun(run, attempt);
      return "skip";
    }

    const now = this.dependencies.clock.now();
    if (attempt.status === "STARTING" || attempt.status === "RUNNING") {
      if (
        attempt.startedAt !== null &&
        attempt.startedAt <
          now - ATTEMPT_TIMEOUT_MS - WORKER_LOST_GRACE_MS
      ) {
        await this.onAttemptFinished(run, attempt, {
          status: "SYSTEM_ERROR",
          systemErrorCode: "WORKER_LOST",
          failureReason: "Attempt worker stopped responding",
          visitedUrls: [],
          consoleErrors: [],
          networkErrors: [],
        });
      }
      return "skip";
    }
    if (attempt.status !== "QUEUED") return "skip";
    return (await this.dependencies.attempts.claimQueued(attempt.id, now))
      ? "execute"
      : "skip";
  }

  async markRunning(
    runId: string,
    attemptId: string,
    attemptIndex: number,
  ): Promise<void> {
    const [run, attempt] = await Promise.all([
      this.dependencies.runs.findByIdForExecution(runId),
      this.dependencies.attempts.findById(attemptId),
    ]);
    if (
      run === null ||
      attempt === null ||
      attempt.testRunId !== runId ||
      attempt.attemptIndex !== attemptIndex ||
      attempt.status !== "STARTING" ||
      isRunTerminal(run)
    ) {
      throw new Error("Attempt is no longer claimable");
    }
    const now = this.dependencies.clock.now();
    const usageEventId =
      run.usageEventId ??
      (await this.dependencies.recordUsage.execute({
        workspaceId: run.workspaceId,
        runId: run.id,
        occurredAt: now,
      }));
    const started = await this.dependencies.attempts.markRunning(
      attempt.id,
      run.id,
      attemptIndex,
      now,
      usageEventId,
    );
    if (!started) throw new Error("Attempt is no longer claimable");
  }

  async onAttemptFinished(
    run: TestRun,
    attempt: TestAttempt,
    outcome: AttemptOutcome,
  ): Promise<void> {
    const [freshRun, freshAttempt] = await Promise.all([
      this.dependencies.runs.findByIdForExecution(run.id),
      this.dependencies.attempts.findById(attempt.id),
    ]);
    if (
      freshRun === null ||
      freshAttempt === null ||
      isRunTerminal(freshRun) ||
      freshAttempt.finishedAt !== null
    ) {
      return;
    }
    const finishedAt = this.dependencies.clock.now();
    await this.dependencies.attempts.update(freshAttempt.id, {
      status: outcome.status,
      finishedAt,
      durationMs: attemptDuration(freshAttempt, finishedAt),
      summary: outcome.summary ?? null,
      expectedResult: outcome.expectedResult ?? null,
      actualResult: outcome.actualResult ?? null,
      failureReason: outcome.failureReason ?? null,
      visitedUrlsJson: JSON.stringify(outcome.visitedUrls),
      consoleErrorsJson: JSON.stringify(outcome.consoleErrors),
      networkErrorsJson: JSON.stringify(outcome.networkErrors),
      tokenUsage: outcome.tokenUsage ?? null,
      modelName: outcome.modelName ?? null,
      runnerVersion: outcome.runnerVersion ?? null,
      systemErrorCode: outcome.systemErrorCode ?? null,
    });
    const [currentRun, allAttempts] = await Promise.all([
      this.dependencies.runs.findByIdForExecution(freshRun.id),
      this.dependencies.attempts.listForRun(freshRun.id),
    ]);
    if (currentRun === null || isRunTerminal(currentRun)) return;
    const action = decideAfterAttempt({
      attemptIndex: freshAttempt.attemptIndex,
      attemptStatus: outcome.status,
      maxRetries: currentRun.snapshot.maxRetries,
      infraAttempts: currentRun.infraAttempts,
      priorFunctionalStatuses: allAttempts
        .filter(
          (candidate) =>
            candidate.id !== freshAttempt.id &&
            (candidate.status === "FAILED" || candidate.status === "TIMEOUT"),
        )
        .map((candidate) =>
          candidate.status === "TIMEOUT" ? "TIMEOUT" : "FAILED",
        ),
      anyAttemptEverStarted: currentRun.startedAt !== null,
    });

    if (action.kind === "retry") {
      await this.scheduleFunctionalRetry(currentRun, action);
      return;
    }
    if (action.kind === "infra_retry") {
      await this.scheduleInfrastructureRetry(
        currentRun,
        freshAttempt,
        allAttempts.length,
        action.delaySeconds,
      );
      return;
    }
    const attemptCount = allAttempts.length;
    const finalChanges = {
      status: action.runStatus,
      finishedAt,
      durationMs: computeRunDuration(currentRun.queuedAt, finishedAt),
      attemptCount,
      passedAfterRetry: action.passedAfterRetry,
      billable: !action.reverseUsage,
    } as const;
    await this.dependencies.runs.finalize(currentRun.id, finalChanges);
    if (action.reverseUsage) {
      await this.dependencies.reverseUsage.execute({ runId: currentRun.id });
    }
    const finalizedRun: TestRun = { ...currentRun, ...finalChanges };
    await this.dependencies.runFinalizedHandler.handle(
      finalizedRun,
      finalizedRun.snapshot,
    );
  }

  private async scheduleFunctionalRetry(
    run: TestRun,
    action: Extract<
      ReturnType<typeof decideAfterAttempt>,
      { kind: "retry" }
    >,
  ): Promise<void> {
    const now = this.dependencies.clock.now();
    let nextAttempt = await this.dependencies.attempts.findByRunAndIndex(
      run.id,
      action.nextIndex,
    );
    if (nextAttempt === null) {
      nextAttempt = queuedAttempt({
        id: this.dependencies.ids.newId("att"),
        runId: run.id,
        attemptIndex: action.nextIndex,
        retryDelaySeconds: action.delaySeconds,
        now,
      });
      await this.dependencies.attempts.insert(nextAttempt);
    }
    const attemptCount = (await this.dependencies.attempts.listForRun(run.id))
      .length;
    await this.dependencies.runs.setAttemptCount(run.id, attemptCount);
    await this.dependencies.queue.send(
      {
        kind: "attempt",
        runId: run.id,
        attemptId: nextAttempt.id,
        attemptIndex: nextAttempt.attemptIndex,
      },
      { delaySeconds: action.delaySeconds },
    );
  }

  private async scheduleInfrastructureRetry(
    run: TestRun,
    attempt: TestAttempt,
    attemptCount: number,
    delaySeconds: number,
  ): Promise<void> {
    await this.dependencies.runs.incrementInfraAttempts(run.id);
    await this.dependencies.runs.setAttemptCount(run.id, attemptCount);
    const screenshots = (
      await this.dependencies.artifacts.listForAttempt(attempt.id)
    ).filter((artifact) => artifact.type === "SCREENSHOT");
    await this.dependencies.steps.deleteForAttempt(attempt.id);
    await this.dependencies.storage.delete(
      screenshots.map((artifact) => artifact.storageKey),
    );
    await this.dependencies.artifacts.deleteByIds(
      screenshots.map((artifact) => artifact.id),
    );
    await this.dependencies.attempts.resetForInfraRetry(
      attempt.id,
      this.dependencies.clock.now(),
    );
    await this.dependencies.queue.send(
      {
        kind: "attempt",
        runId: run.id,
        attemptId: attempt.id,
        attemptIndex: attempt.attemptIndex,
      },
      { delaySeconds },
    );
  }

  private async cancelDeletedRun(
    run: TestRun,
    attempt: TestAttempt,
  ): Promise<void> {
    const finishedAt = this.dependencies.clock.now();
    await this.dependencies.attempts.update(attempt.id, {
      status: "SYSTEM_ERROR",
      finishedAt,
      durationMs: attemptDuration(attempt, finishedAt),
      summary: null,
      expectedResult: null,
      actualResult: null,
      failureReason: null,
      visitedUrlsJson: "[]",
      consoleErrorsJson: "[]",
      networkErrorsJson: "[]",
      tokenUsage: null,
      systemErrorCode: "CANCELLED",
    });
    const attemptCount = (await this.dependencies.attempts.listForRun(run.id))
      .length;
    await this.dependencies.runs.finalize(run.id, {
      status: "SYSTEM_ERROR",
      finishedAt,
      durationMs: computeRunDuration(run.queuedAt, finishedAt),
      attemptCount,
      passedAfterRetry: false,
      billable: false,
    });
    await this.dependencies.reverseUsage.execute({ runId: run.id });
  }
}
