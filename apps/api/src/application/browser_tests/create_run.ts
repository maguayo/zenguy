import { ensureActiveSubscription } from "../billing/ensure_active_subscription";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import type {
  BrowserTestRepo,
  RunRepo,
} from "../../domain/browser_tests/repo";
import { buildSnapshot } from "../../domain/browser_tests/rules";
import { authorizeIrreversibleRun } from "../../domain/browser_tests/irreversible_authorization";
import type { BrowserTestConfig } from "../../domain/browser_tests/rules";
import type {
  RunSource,
  TestAttempt,
  TestRun,
} from "../../domain/browser_tests/types";
import type { AttemptMessage } from "../../domain/queues";
import type { DurableWorkflowRepo } from "../../domain/durability/repo";
import type { WorkspaceRepo } from "../../domain/workspaces/repo";
import type { Clock } from "../../shared/clock";
import type { AppConfig } from "../../shared/config";
import { AppError, notFound, validation } from "../../shared/errors";
import type { IdGenerator } from "../../shared/ids";
import { platformAlert } from "../../shared/log";
import { createOutboxEntry } from "../durability/factory";
import type { PublishQueueOutbox } from "../durability/publish_outbox";
import { parseBrowserTestConfig } from "./input";

export class CreateRun {
  constructor(
    private readonly tests: BrowserTestRepo,
    private readonly runs: RunRepo,
    private readonly workspaces: WorkspaceRepo,
    private readonly subscriptions: SubscriptionRepo,
    private readonly durable: Pick<DurableWorkflowRepo, "insertRunWithAttempt">,
    private readonly outboxPublisher: Pick<PublishQueueOutbox, "publishById">,
    private readonly config: Pick<
      AppConfig,
      "llmModel" | "runnerCapabilitySecret"
    >,
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
    approveIrreversibleActions?: true;
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
    let runConfig: BrowserTestConfig;
    if (input.testId !== undefined) {
      const test = await this.tests.findById(input.workspaceId, input.testId);
      if (test === null) throw notFound("Browser test");
      testId = test.id;
      runConfig = parseBrowserTestConfig({
          name: test.name,
          allowedDomains: [...(test.allowedDomains ?? [])],
          writableDomains: [...(test.writableDomains ?? [])],
          testDataAttested: test.testDataAttested ?? false,
          irreversibleActionScopes: structuredClone(
            test.irreversibleActionScopes ?? [],
          ),
          startUrl: test.startUrl,
          instructions: test.instructions,
          device: test.device,
          intervalHours: test.intervalHours,
          maxRetries: test.maxRetries,
          notifyOnRecovery: test.notifyOnRecovery,
          channelIds: await this.tests.getChannelIds(test.id),
        });
      snapshot = buildSnapshot(runConfig, this.config.llmModel);
    } else {
      runConfig = parseBrowserTestConfig(input.config);
      snapshot = buildSnapshot(runConfig, this.config.llmModel);
    }

    if ((await this.workspaces.findById(input.workspaceId)) === null) {
      throw notFound("Workspace");
    }
    await ensureActiveSubscription(
      this.subscriptions,
      input.workspaceId,
      this.clock.now(),
    );
    if (testId !== null && (await this.runs.activeRunExists(testId))) {
      throw new AppError(
        "ACTIVE_RUN_EXISTS",
        "A run is already in progress for this test",
      );
    }

    const now = this.clock.now();
    const runId = this.ids.newId("run");
    const attemptId = this.ids.newId("att");
    const humanApproved =
      input.approveIrreversibleActions === true &&
      input.source !== "SCHEDULED" &&
      input.triggeredByUserId !== undefined;
    if (humanApproved && runConfig.irreversibleActionScopes.length > 0) {
      const approvedByUserId = input.triggeredByUserId;
      if (approvedByUserId === undefined) {
        throw new Error("Human approval requires an authenticated user");
      }
      snapshot.irreversibleAuthorization = await authorizeIrreversibleRun({
        snapshot,
        runId,
        workspaceId: input.workspaceId,
        approvedByUserId,
        approvedAt: now,
        scopes: runConfig.irreversibleActionScopes,
        signingSecret: this.config.runnerCapabilitySecret,
      });
    }
    const run: TestRun = {
      id: runId,
      workspaceId: input.workspaceId,
      browserTestId: testId,
      source: input.source,
      status: "QUEUED",
      snapshot,
      actionAuthorizations:
        snapshot.irreversibleAuthorization === undefined
          ? []
          : snapshot.irreversibleAuthorization.scopes.map((scope) => ({
              scope: structuredClone(scope),
              remainingUses: scope.maxUses,
            })),
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
      inputTokens: null,
      outputTokens: null,
      modelName: null,
      runnerVersion: null,
      runnerKind: null,
      systemErrorCode: null,
      createdAt: now,
    };
    const message: AttemptMessage = {
      kind: "attempt",
      runId,
      attemptId,
      attemptIndex: 0,
      executionGeneration: attempt.queuedAt,
    };
    const outbox = createOutboxEntry({
      dedupeKey: `attempt:${attemptId}:initial`,
      queueKind: "RUN",
      payload: message,
      availableAt: now,
      now,
      ids: this.ids,
    });
    try {
      await this.durable.insertRunWithAttempt(run, attempt, outbox);
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes("ZENGUY_WORKSPACE_ACTIVE_RUN_CAP") ||
          error.message.includes("ZENGUY_USER_ACTIVE_RUN_CAP") ||
          error.message.includes("ZENGUY_OWNER_ACTIVE_RUN_CAP") ||
          error.message.includes("ZENGUY_GLOBAL_ACTIVE_RUN_CAP") ||
          error.message.includes("ZENGUY_WORKSPACE_DAILY_RUN_CAP") ||
          error.message.includes("ZENGUY_USER_DAILY_RUN_CAP") ||
          error.message.includes("ZENGUY_OWNER_DAILY_RUN_CAP") ||
          error.message.includes("ZENGUY_GLOBAL_DAILY_RUN_CAP") ||
          error.message.includes("ZENGUY_WORKSPACE_MONTHLY_RUN_CAP") ||
          error.message.includes("ZENGUY_USER_MONTHLY_RUN_CAP") ||
          error.message.includes("ZENGUY_OWNER_MONTHLY_RUN_CAP") ||
          error.message.includes("ZENGUY_GLOBAL_MONTHLY_RUN_CAP"))
      ) {
        platformAlert("browser_run_cost_cap_reached", {
          workspaceId: input.workspaceId,
          actorUserId: input.triggeredByUserId ?? null,
          databaseGuard: error.message.match(/ZENGUY_[A-Z_]+/u)?.[0] ?? null,
        });
        throw new AppError(
          "RATE_LIMITED",
          "The browser run safety limit has been reached",
        );
      }
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
    try {
      await this.outboxPublisher.publishById(outbox.id);
    } catch {
      platformAlert("initial_attempt_publish_deferred", { runId, attemptId });
    }
    return run;
  }
}
