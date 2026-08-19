import type {
  ArtifactRepo,
  AttemptRepo,
  RunRepo,
  StepRepo,
} from "../../domain/browser_tests/repo";
import type { RunArtifact } from "../../domain/browser_tests/types";
import { signArtifactUrl } from "../../http/artifact_sign";
import type { Clock } from "../../shared/clock";
import type { AppConfig } from "../../shared/config";
import { notFound } from "../../shared/errors";
import type {
  ArtifactRefOutput,
  AttemptDetailOutput,
  ConsoleErrorOutput,
  NetworkErrorOutput,
} from "./run_models";
import {
  runOutputRedactor,
  type RunSecretResolver,
} from "./redact_run_output";

function parseArray<T>(raw: string | null): T[] {
  if (raw === null) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
}

export class GetAttempt {
  constructor(
    private readonly attempts: AttemptRepo,
    private readonly runs: RunRepo,
    private readonly steps: StepRepo,
    private readonly artifacts: ArtifactRepo,
    private readonly config: Pick<AppConfig, "artifactUrlSecret">,
    private readonly clock: Clock,
    private readonly resolveSecrets?: RunSecretResolver,
  ) {}

  async execute(input: {
    workspaceId: string;
    attemptId: string;
  }): Promise<AttemptDetailOutput> {
    const attempt = await this.attempts.findById(input.attemptId);
    if (attempt === null) throw notFound("Attempt");
    const run = await this.runs.findById(input.workspaceId, attempt.testRunId);
    if (run === null) throw notFound("Attempt");
    const [steps, artifacts] = await Promise.all([
      this.steps.listForAttempt(attempt.id),
      this.artifacts.listForAttempt(attempt.id),
    ]);
    const screenshots = artifacts.filter(
      (artifact) =>
        artifact.type === "SCREENSHOT" &&
        artifact.runId === run.id &&
        artifact.workspaceId === input.workspaceId,
    );
    const now = this.clock.now();
    const references = new Map<string, ArtifactRefOutput>();
    await Promise.all(
      screenshots.map(async (artifact) => {
        references.set(artifact.id, await this.artifactRef(artifact, now));
      }),
    );
    const latestStep = steps.at(-1) ?? null;
    const latestScreenshot = screenshots.at(-1) ?? null;
    const output: AttemptDetailOutput = {
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
      latestStep:
        latestStep === null
          ? null
          : {
              description: latestStep.description,
              actionType: latestStep.actionType,
              timestamp: latestStep.timestamp,
            },
      latestScreenshot:
        latestScreenshot === null
          ? null
          : {
              id: latestScreenshot.id,
              url: references.get(latestScreenshot.id)?.url ?? "",
            },
      expectedResult: attempt.expectedResult,
      actualResult: attempt.actualResult,
      tokenUsage: attempt.tokenUsage,
      modelName: attempt.modelName,
      runnerVersion: attempt.runnerVersion,
      systemErrorCode: attempt.systemErrorCode,
      visitedUrls: parseArray<string>(attempt.visitedUrlsJson),
      consoleErrors: parseArray<ConsoleErrorOutput>(attempt.consoleErrorsJson),
      networkErrors: parseArray<NetworkErrorOutput>(attempt.networkErrorsJson),
      steps: steps.map((step) => ({
        sequence: step.sequence,
        timestamp: step.timestamp,
        actionType: step.actionType,
        description: step.description,
        urlSanitized: step.urlSanitized,
        result: step.result,
        screenshot:
          step.artifactId === null
            ? null
            : (references.get(step.artifactId) ?? null),
      })),
      screenshots: screenshots.flatMap((artifact) => {
        const reference = references.get(artifact.id);
        return reference === undefined ? [] : [reference];
      }),
    };
    const redactor = await runOutputRedactor(
      input.workspaceId,
      run.snapshot,
      this.resolveSecrets,
    );
    return redactor.redactDeep(output);
  }

  private async artifactRef(
    artifact: RunArtifact,
    now: number,
  ): Promise<ArtifactRefOutput> {
    return {
      id: artifact.id,
      url: await signArtifactUrl(this.config, artifact.id, now),
      expiresAt: artifact.expiresAt,
    };
  }
}
