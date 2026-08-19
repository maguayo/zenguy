import type {
  AttemptRepo,
  RunRepo,
} from "../../domain/browser_tests/repo";
import type { UserRepo } from "../../domain/users/repo";
import { signArtifactUrl } from "../../http/artifact_sign";
import type { Clock } from "../../shared/clock";
import type { AppConfig } from "../../shared/config";
import { hmacSign } from "../../shared/crypto";
import { notFound } from "../../shared/errors";
import type {
  AttemptSummaryOutput,
  RunDetailOutput,
  UserRefOutput,
} from "./run_models";
import {
  runOutputRedactor,
  type RunSecretResolver,
} from "./redact_run_output";

const RUN_SSE_TTL_SECONDS = 900;

export class GetRun {
  constructor(
    private readonly runs: RunRepo,
    private readonly attempts: AttemptRepo,
    private readonly users: UserRepo,
    private readonly config: Pick<AppConfig, "artifactUrlSecret">,
    private readonly clock: Clock,
    private readonly resolveSecrets?: RunSecretResolver,
  ) {}

  async execute(input: {
    workspaceId: string;
    runId: string;
  }): Promise<RunDetailOutput> {
    const run = await this.runs.findById(input.workspaceId, input.runId);
    if (run === null) throw notFound("Run");
    const now = this.clock.now();
    const [attemptRows, triggeringUser] = await Promise.all([
      this.attempts.listForRunWithLatest(run.id),
      run.triggeredByUserId === null
        ? Promise.resolve(null)
        : this.users.findById(run.triggeredByUserId),
    ]);
    const attempts: AttemptSummaryOutput[] = await Promise.all(
      attemptRows.map(async ({ attempt, latestStep, latestScreenshot }) => ({
        id: attempt.id,
        attemptIndex: attempt.attemptIndex,
        status: attempt.status,
        retryDelaySeconds: attempt.retryDelaySeconds,
        queuedAt: attempt.queuedAt,
        startedAt: attempt.startedAt,
        finishedAt: attempt.finishedAt,
        durationMs: attempt.durationMs,
        summary: attempt.summary,
        failureReason: attempt.failureReason,
        latestStep,
        latestScreenshot:
          latestScreenshot === null
            ? null
            : {
                id: latestScreenshot.id,
                url: await signArtifactUrl(
                  this.config,
                  latestScreenshot.id,
                  now,
                ),
              },
      })),
    );
    const triggeredBy: UserRefOutput =
      triggeringUser === null
        ? null
        : { userId: triggeringUser.id, name: triggeringUser.name };
    const output: RunDetailOutput = {
      id: run.id,
      testId: run.browserTestId,
      source: run.source,
      status: run.status,
      snapshot: run.snapshot,
      scheduledFor: run.scheduledFor,
      queuedAt: run.queuedAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      durationMs: run.durationMs,
      attemptCount: run.attemptCount,
      passedAfterRetry: run.passedAfterRetry,
      billable: run.billable,
      incidentId: run.incidentId,
      triggeredBy,
      attempts,
      live:
        run.status === "QUEUED" || run.status === "RUNNING"
          ? { url: await this.liveUrl(input.workspaceId, run.id, now) }
          : null,
    };
    const redactor = await runOutputRedactor(
      input.workspaceId,
      run.snapshot,
      this.resolveSecrets,
    );
    return redactor.redactDeep(output);
  }

  private async liveUrl(
    workspaceId: string,
    runId: string,
    now: number,
  ): Promise<string> {
    const exp = Math.floor(now / 1_000) + RUN_SSE_TTL_SECONDS;
    const sig = await hmacSign(
      this.config.artifactUrlSecret,
      `sse.${runId}.${exp}`,
    );
    const query = new URLSearchParams({ exp: String(exp), sig });
    return `/api/workspaces/${workspaceId}/runs/${runId}/events?${query.toString()}`;
  }
}
