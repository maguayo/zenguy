import { ensureActiveSubscription } from "../billing/ensure_active_subscription";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import type {
  BrowserTestRepo,
  RunRepo,
} from "../../domain/browser_tests/repo";
import { buildSnapshot } from "../../domain/browser_tests/rules";
import type {
  RunSource,
  TestAttempt,
  TestRun,
} from "../../domain/browser_tests/types";
import type { AttemptMessage } from "../../domain/queues";
import type { WorkspaceRepo } from "../../domain/workspaces/repo";
import type { Clock } from "../../shared/clock";
import type { AppConfig } from "../../shared/config";
import { AppError, notFound, validation } from "../../shared/errors";
import type { IdGenerator } from "../../shared/ids";
import { parseBrowserTestConfig } from "./input";

export class CreateRun {
  constructor(
    private readonly tests: BrowserTestRepo,
    private readonly runs: RunRepo,
    private readonly workspaces: WorkspaceRepo,
    private readonly subscriptions: SubscriptionRepo,
    private readonly queue: Pick<Queue<AttemptMessage>, "send">,
    private readonly config: Pick<AppConfig, "llmModel">,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: {
    workspaceId: string;
    source: RunSource;
    testId?: string;
    config?: unknown;
    triggeredByUserId?: string;
    scheduledFor?: number;
  }): Promise<TestRun> {
    if (
      (input.testId === undefined) === (input.config === undefined)
    ) {
      throw validation([
        { field: "run", message: "Provide exactly one testId or config" },
      ]);
    }

    let testId: string | null = null;
    let snapshot;
    if (input.testId !== undefined) {
      const test = await this.tests.findById(input.workspaceId, input.testId);
      if (test === null) throw notFound("Browser test");
      testId = test.id;
      snapshot = buildSnapshot(
        {
          name: test.name,
          startUrl: test.startUrl,
          instructions: test.instructions,
          device: test.device,
          intervalHours: test.intervalHours,
          maxRetries: test.maxRetries,
          notifyOnRecovery: test.notifyOnRecovery,
          channelIds: await this.tests.getChannelIds(test.id),
        },
        this.config.llmModel,
      );
    } else {
      snapshot = buildSnapshot(
        parseBrowserTestConfig(input.config),
        this.config.llmModel,
      );
    }

    if ((await this.workspaces.findById(input.workspaceId)) === null) {
      throw notFound("Workspace");
    }
    await ensureActiveSubscription(this.subscriptions, input.workspaceId);
    if (testId !== null && (await this.runs.activeRunExists(testId))) {
      throw new AppError(
        "ACTIVE_RUN_EXISTS",
        "A run is already in progress for this test",
      );
    }

    const now = this.clock.now();
    const runId = this.ids.newId("run");
    const attemptId = this.ids.newId("att");
    const run: TestRun = {
      id: runId,
      workspaceId: input.workspaceId,
      browserTestId: testId,
      source: input.source,
      status: "QUEUED",
      snapshot,
      scheduledFor: input.scheduledFor ?? null,
      queuedAt: now,
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      attemptCount: 0,
      infraAttempts: 0,
      passedAfterRetry: false,
      billable: true,
      usageEventId: null,
      triggeredByUserId: input.triggeredByUserId ?? null,
      incidentId: null,
      createdAt: now,
    };
    const attempt: TestAttempt = {
      id: attemptId,
      testRunId: runId,
      attemptIndex: 0,
      status: "QUEUED",
      retryDelaySeconds: 0,
      queuedAt: now,
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
      createdAt: now,
    };
    try {
      await this.runs.insertWithAttempt(run, attempt);
    } catch (error) {
      if (
        testId !== null &&
        input.scheduledFor !== undefined &&
        (await this.runs.scheduledOccurrenceExists(
          testId,
          input.scheduledFor,
        ))
      ) {
        throw new AppError(
          "CONFLICT",
          "Scheduled occurrence already exists",
        );
      }
      if (testId !== null && (await this.runs.activeRunExists(testId))) {
        throw new AppError(
          "ACTIVE_RUN_EXISTS",
          "A run is already in progress for this test",
        );
      }
      throw error;
    }
    await this.queue.send({
      kind: "attempt",
      runId,
      attemptId,
      attemptIndex: 0,
    });
    return run;
  }
}
