import type { TrackEvent } from "../activity/track_event";
import type { RecordRunUsage } from "../billing/record_run_usage";
import type { ReverseRunUsage } from "../billing/reverse_run_usage";
import {
  ACTIVITY_EVENTS,
  type ActivityEventType,
} from "../../domain/activity/catalog";
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
  RunnerKind,
} from "../../domain/browser_tests/types";
import type { AttemptMessage } from "../../domain/queues";
import type { DurableWorkflowRepo } from "../../domain/durability/repo";
import type { DurableJob } from "../../domain/durability/types";
import type { WorkspaceRepo } from "../../domain/workspaces/repo";
import type { ArtifactStorage } from "../../infrastructure/storage/artifacts";
import type { Clock } from "../../shared/clock";
import { ATTEMPT_TIMEOUT_MS } from "../../shared/constants";
import type { IdGenerator } from "../../shared/ids";
import { platformAlert } from "../../shared/log";
import { createDurableJob, createOutboxEntry } from "../durability/factory";
import type { PublishQueueOutbox } from "../durability/publish_outbox";

export const WORKER_LOST_GRACE_MS = 120_000;

/** The reported total wins; otherwise the breakdown adds up to it. */
export function totalTokenUsage(
  outcome: Pick<AttemptOutcome, "tokenUsage" | "inputTokens" | "outputTokens">,
): number | null {
  if (outcome.tokenUsage !== undefined) return outcome.tokenUsage;
  if (outcome.inputTokens === undefined && outcome.outputTokens === undefined) {
    return null;
  }
  return (outcome.inputTokens ?? 0) + (outcome.outputTokens ?? 0);
}

export interface AttemptOutcome {
  status: "PASSED" | "FAILED" | "TIMEOUT" | "SYSTEM_ERROR";
  summary?: string;
  expectedResult?: string;
  actualResult?: string;
  failureReason?: string;
  systemErrorCode?: string;
  tokenUsage?: number;
  inputTokens?: number;
  outputTokens?: number;
  modelName?: string;
  runnerVersion?: string;
  runnerKind?: RunnerKind;
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
  recordUsage: Pick<RecordRunUsage, "buildEvent">;
  reverseUsage: Pick<ReverseRunUsage, "execute">;
  durable: DurableWorkflowRepo;
  outboxPublisher: Pick<PublishQueueOutbox, "publishById">;
  clock: Clock;
  ids: IdGenerator;
  runFinalizedHandler: RunFinalizedHandler;
  track?: Pick<TrackEvent, "execute">;
}

const RUN_ACTIVITY: Record<
  "PASSED" | "FAILED" | "TIMEOUT" | "SYSTEM_ERROR",
  ActivityEventType
> = {
  PASSED: ACTIVITY_EVENTS.browserTestRunPassed,
  FAILED: ACTIVITY_EVENTS.browserTestRunFailed,
  TIMEOUT: ACTIVITY_EVENTS.browserTestRunTimedOut,
  SYSTEM_ERROR: ACTIVITY_EVENTS.browserTestRunErrored,
};

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
  queuedAt: number;
  createdAt: number;
}): TestAttempt {
  return {
    id: input.id,
    testRunId: input.runId,
    attemptIndex: input.attemptIndex,
    status: "QUEUED",
    retryDelaySeconds: input.retryDelaySeconds,
    queuedAt: input.queuedAt,
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
    createdAt: input.createdAt,
  };
}

interface AttemptContinuationPayload {
  runId: string;
  attemptId: string;
}

interface RunFinalizationPayload {
  runId: string;
  reverseUsage: boolean;
  handleFinalized?: boolean;
}

function attemptJobKey(attemptId: string, infraAttempts: number): string {
  return `${attemptId}:${infraAttempts}`;
}

function parsePayload<T>(job: DurableJob): T {
  return JSON.parse(job.payloadJson) as T;
}

export class AttemptLifecycle {
  constructor(private readonly dependencies: AttemptLifecycleDependencies) {}

  async claim(
    message: AttemptMessage,
    runnerDeliveryId?: string,
    claimedByRunnerId?: string,
  ): Promise<"execute" | "skip"> {
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
    if (isRunTerminal(run)) {
      await this.resumeRunFinalization(run.id);
      return "skip";
    }
    if (attempt.queuedAt !== message.executionGeneration) {
      platformAlert("stale_attempt_message_ignored", {
        runId: message.runId,
        attemptId: message.attemptId,
      });
      return "skip";
    }
    const continuation = await this.dependencies.durable.findJob(
      "ATTEMPT_CONTINUATION",
      attemptJobKey(attempt.id, run.infraAttempts),
    );
    if (continuation?.status === "PENDING") {
      await this.resumeAttemptContinuation(continuation);
      return "skip";
    }
    const [workspace, test] = await Promise.all([
      this.dependencies.workspaces.findById(run.workspaceId),
      run.browserTestId === null
        ? Promise.resolve(null)
        : this.dependencies.tests.findById(run.workspaceId, run.browserTestId),
    ]);
    if (workspace === null || (run.browserTestId !== null && test === null)) {
      // A QUEUED attempt has not acquired execution ownership and can be
      // cancelled safely. Once STARTING/RUNNING, deletion must not let a
      // redelivery terminalise work owned by the active worker.
      if (attempt.status === "QUEUED") {
        await this.cancelDeletedRun(run, attempt);
      }
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
        return "skip";
      }
      if (
        attempt.status === "STARTING" &&
        runnerDeliveryId !== undefined &&
        (await this.dependencies.attempts.isRunnerDeliveryOwner(
          attempt.id,
          runnerDeliveryId,
        ))
      ) {
        return "execute";
      }
      return "skip";
    }
    if (attempt.status !== "QUEUED") return "skip";
    return (await this.dependencies.attempts.claimQueued(
      attempt.id,
      now,
      runnerDeliveryId,
      claimedByRunnerId,
    ))
      ? "execute"
      : "skip";
  }

  async markRunning(
    runId: string,
    attemptId: string,
    attemptIndex: number,
    executionGeneration: number,
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
      attempt.queuedAt !== executionGeneration ||
      attempt.status !== "STARTING" ||
      isRunTerminal(run)
    ) {
      throw new Error("Attempt is no longer claimable");
    }
    const now = this.dependencies.clock.now();
    const usageEvent = this.dependencies.recordUsage.buildEvent({
      workspaceId: run.workspaceId,
      runId: run.id,
      occurredAt: now,
    });
    const started = await this.dependencies.attempts.markRunning(
      attempt.id,
      run.id,
      attemptIndex,
      now,
      usageEvent,
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
    if (freshRun === null || freshAttempt === null) return;
    if (freshAttempt.queuedAt !== attempt.queuedAt) {
      platformAlert("stale_attempt_generation_ignored", {
        runId: run.id,
        attemptId: attempt.id,
      });
      return;
    }
    if (isRunTerminal(freshRun)) {
      await this.resumeRunFinalization(freshRun.id);
      return;
    }
    const aggregateKey = attemptJobKey(
      freshAttempt.id,
      freshRun.infraAttempts,
    );
    let job = await this.dependencies.durable.findJob(
      "ATTEMPT_CONTINUATION",
      aggregateKey,
    );
    if (job === null && freshAttempt.finishedAt === null) {
      const finishedAt = this.dependencies.clock.now();
      job = await this.dependencies.durable.recordAttemptCompletion({
        attemptId: freshAttempt.id,
        fields: {
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
          tokenUsage: totalTokenUsage(outcome),
          inputTokens: outcome.inputTokens ?? null,
          outputTokens: outcome.outputTokens ?? null,
          modelName: outcome.modelName ?? null,
          runnerVersion: outcome.runnerVersion ?? null,
          runnerKind: outcome.runnerKind ?? null,
          systemErrorCode: outcome.systemErrorCode ?? null,
        },
        job: createDurableJob({
          kind: "ATTEMPT_CONTINUATION",
          aggregateKey,
          payload: {
            runId: freshRun.id,
            attemptId: freshAttempt.id,
          } satisfies AttemptContinuationPayload,
          now: finishedAt,
          ids: this.dependencies.ids,
        }),
      });
    }
    if (job?.status === "PENDING") {
      await this.resumeAttemptContinuation(job);
    }
  }

  async resumePendingJobs(limit = 100): Promise<void> {
    const jobs = await this.dependencies.durable.listPendingJobs(
      ["ATTEMPT_CONTINUATION", "RUN_FINALIZATION"],
      limit,
    );
    for (const job of jobs) {
      try {
        if (job.kind === "ATTEMPT_CONTINUATION") {
          await this.resumeAttemptContinuation(job);
        } else if (job.kind === "RUN_FINALIZATION") {
          await this.resumeRunFinalization(job.aggregateKey);
        }
      } catch (error) {
        platformAlert("durable_attempt_job_failed", {
          jobId: job.id,
          error: error instanceof Error ? error.message : "unknown error",
        });
      }
    }
  }

  private async resumeAttemptContinuation(job: DurableJob): Promise<void> {
    if (job.status !== "PENDING") return;
    const payload = parsePayload<AttemptContinuationPayload>(job);
    const [currentRun, currentAttempt, allAttempts] = await Promise.all([
      this.dependencies.runs.findByIdForExecution(payload.runId),
      this.dependencies.attempts.findById(payload.attemptId),
      this.dependencies.attempts.listForRun(payload.runId),
    ]);
    if (currentRun === null || currentAttempt === null) {
      platformAlert("attempt_continuation_missing", {
        jobId: job.id,
        runId: payload.runId,
        attemptId: payload.attemptId,
      });
      return;
    }
    if (isRunTerminal(currentRun)) {
      await this.resumeRunFinalization(currentRun.id);
      await this.dependencies.durable.completeJob(
        job.id,
        this.dependencies.clock.now(),
      );
      return;
    }
    if (
      currentAttempt.finishedAt === null ||
      (currentAttempt.status !== "PASSED" &&
        currentAttempt.status !== "FAILED" &&
        currentAttempt.status !== "TIMEOUT" &&
        currentAttempt.status !== "SYSTEM_ERROR")
    ) {
      throw new Error("Attempt continuation has no completed outcome");
    }
    const action = decideAfterAttempt({
      attemptIndex: currentAttempt.attemptIndex,
      attemptStatus: currentAttempt.status,
      maxRetries: currentRun.snapshot.maxRetries,
      infraAttempts: currentRun.infraAttempts,
      priorFunctionalStatuses: allAttempts
        .filter(
          (candidate) =>
            candidate.id !== currentAttempt.id &&
            (candidate.status === "FAILED" || candidate.status === "TIMEOUT"),
        )
        .map((candidate) =>
          candidate.status === "TIMEOUT" ? "TIMEOUT" : "FAILED",
        ),
      anyAttemptEverStarted: currentRun.startedAt !== null,
    });

    if (action.kind === "retry") {
      await this.scheduleFunctionalRetry(job, currentRun, action);
      return;
    }
    if (action.kind === "infra_retry") {
      await this.scheduleInfrastructureRetry(
        job,
        currentRun,
        currentAttempt,
        allAttempts.length,
        action.delaySeconds,
      );
      return;
    }
    const attemptCount = allAttempts.length;
    const finishedAt = currentAttempt.finishedAt;
    const finalChanges = {
      status: action.runStatus,
      finishedAt,
      durationMs: computeRunDuration(
        currentRun.startedAt ?? currentRun.queuedAt,
        finishedAt,
      ),
      attemptCount,
      passedAfterRetry: action.passedAfterRetry,
      billable: !action.reverseUsage,
    } as const;
    const finalizationJob = createDurableJob({
      kind: "RUN_FINALIZATION",
      aggregateKey: currentRun.id,
      payload: {
        runId: currentRun.id,
        reverseUsage: action.reverseUsage,
      } satisfies RunFinalizationPayload,
      now: finishedAt,
      ids: this.dependencies.ids,
    });
    await this.dependencies.durable.finalizeRun({
      jobId: job.id,
      runId: currentRun.id,
      changes: finalChanges,
      finalizationJob,
      at: finishedAt,
    });
    await this.resumeRunFinalization(currentRun.id);
  }

  private async scheduleFunctionalRetry(
    job: DurableJob,
    run: TestRun,
    action: Extract<
      ReturnType<typeof decideAfterAttempt>,
      { kind: "retry" }
    >,
  ): Promise<void> {
    const now = this.dependencies.clock.now();
    const availableAt = now + action.delaySeconds * 1_000;
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
        queuedAt: availableAt,
        createdAt: now,
      });
    }
    const message: AttemptMessage = {
      kind: "attempt",
      runId: run.id,
      attemptId: nextAttempt.id,
      attemptIndex: nextAttempt.attemptIndex,
      executionGeneration: nextAttempt.queuedAt,
    };
    const outbox = createOutboxEntry({
      dedupeKey: `attempt:${nextAttempt.id}:functional`,
      queueKind: "RUN",
      payload: message,
      availableAt,
      now,
      ids: this.dependencies.ids,
    });
    await this.dependencies.durable.scheduleFunctionalRetry({
      jobId: job.id,
      runId: run.id,
      nextAttempt,
      outbox,
      at: now,
    });
    await this.publishDeferred(outbox.id, "functional_retry_publish_deferred");
  }

  private async scheduleInfrastructureRetry(
    job: DurableJob,
    run: TestRun,
    attempt: TestAttempt,
    attemptCount: number,
    delaySeconds: number,
  ): Promise<void> {
    const screenshots = (
      await this.dependencies.artifacts.listForAttempt(attempt.id)
    ).filter((artifact) => artifact.type === "SCREENSHOT");
    await this.dependencies.storage.delete(
      screenshots.map((artifact) => artifact.storageKey),
    );
    const now = this.dependencies.clock.now();
    const availableAt = now + delaySeconds * 1_000;
    const message: AttemptMessage = {
      kind: "attempt",
      runId: run.id,
      attemptId: attempt.id,
      attemptIndex: attempt.attemptIndex,
      executionGeneration: availableAt,
    };
    const outbox = createOutboxEntry({
      dedupeKey: `attempt:${attempt.id}:infra:${run.infraAttempts + 1}`,
      queueKind: "RUN",
      payload: message,
      availableAt,
      now,
      ids: this.dependencies.ids,
    });
    await this.dependencies.durable.scheduleInfrastructureRetry({
      jobId: job.id,
      runId: run.id,
      attemptId: attempt.id,
      attemptCount,
      queuedAt: availableAt,
      artifactIds: screenshots.map((artifact) => artifact.id),
      outbox,
      at: now,
    });
    await this.publishDeferred(outbox.id, "infra_retry_publish_deferred");
  }

  private async resumeRunFinalization(runId: string): Promise<void> {
    const job = await this.dependencies.durable.findJob(
      "RUN_FINALIZATION",
      runId,
    );
    if (job === null || job.status !== "PENDING") return;
    const payload = parsePayload<RunFinalizationPayload>(job);
    const run = await this.dependencies.runs.findByIdForExecution(runId);
    if (run === null || !isRunTerminal(run)) {
      throw new Error("Run finalization has no terminal run");
    }
    if (payload.reverseUsage) {
      await this.dependencies.reverseUsage.execute({ runId });
    }
    if (payload.handleFinalized !== false) {
      await this.dependencies.runFinalizedHandler.handle(run, run.snapshot);
      // Recorded right before the job completes: the early return above keeps
      // a completed job from emitting twice. A crash between this call and
      // completeJob can duplicate the event, which is acceptable for analytics.
      // Cancellations (handleFinalized === false: the test or workspace was
      // deleted) are not execution outcomes and record nothing.
      await this.dependencies.track?.execute({
        type: RUN_ACTIVITY[run.status as keyof typeof RUN_ACTIVITY],
        userId: run.triggeredByUserId,
        workspaceId: run.workspaceId,
        source: "server",
        resourceId: run.browserTestId,
        properties: {
          runId: run.id,
          runSource: run.source,
          attemptCount: run.attemptCount,
          durationMs: run.durationMs ?? 0,
          // Named "retried" on purpose: metadata keys containing "pass" are
          // redacted by sanitizeAuditMetadata.
          retried: run.passedAfterRetry,
        },
      });
    }
    await this.dependencies.durable.completeJob(
      job.id,
      this.dependencies.clock.now(),
    );
  }

  private async publishDeferred(outboxId: string, alert: string): Promise<void> {
    try {
      await this.dependencies.outboxPublisher.publishById(outboxId);
    } catch {
      platformAlert(alert, { outboxId });
    }
  }

  private async cancelDeletedRun(
    run: TestRun,
    attempt: TestAttempt,
  ): Promise<void> {
    const finishedAt = this.dependencies.clock.now();
    const aggregateKey = attemptJobKey(attempt.id, run.infraAttempts);
    let job = await this.dependencies.durable.findJob(
      "ATTEMPT_CONTINUATION",
      aggregateKey,
    );
    if (job === null) {
      job = await this.dependencies.durable.recordAttemptCompletion({
        attemptId: attempt.id,
        fields: {
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
          inputTokens: null,
          outputTokens: null,
          modelName: null,
          runnerVersion: null,
          runnerKind: null,
          systemErrorCode: "CANCELLED",
        },
        job: createDurableJob({
          kind: "ATTEMPT_CONTINUATION",
          aggregateKey,
          payload: { runId: run.id, attemptId: attempt.id },
          now: finishedAt,
          ids: this.dependencies.ids,
        }),
      });
    }
    if (job.status !== "PENDING") {
      await this.resumeRunFinalization(run.id);
      return;
    }
    const attemptCount = (await this.dependencies.attempts.listForRun(run.id))
      .length;
    const finalizationJob = createDurableJob({
      kind: "RUN_FINALIZATION",
      aggregateKey: run.id,
      payload: { runId: run.id, reverseUsage: true, handleFinalized: false },
      now: finishedAt,
      ids: this.dependencies.ids,
    });
    await this.dependencies.durable.finalizeRun({
      jobId: job.id,
      runId: run.id,
      changes: {
      status: "SYSTEM_ERROR",
      finishedAt,
      durationMs: computeRunDuration(run.startedAt ?? run.queuedAt, finishedAt),
      attemptCount,
      passedAfterRetry: false,
      billable: false,
      },
      finalizationJob,
      at: finishedAt,
    });
    await this.resumeRunFinalization(run.id);
  }
}
