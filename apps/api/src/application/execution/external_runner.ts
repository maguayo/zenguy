import type {
  ArtifactRepo,
  AttemptRepo,
  RunRepo,
  StepRepo,
} from "../../domain/browser_tests/repo";
import type {
  RunnerAttemptReference,
  RunnerClaimInput,
  RunnerOutcomeInput,
  RunnerStepInput,
} from "../../domain/browser_tests/runner_protocol";
import type { z } from "zod";
import { runnerAuthorizeActionSchema } from "../../domain/browser_tests/runner_protocol";
import {
  actionMatchesScope,
  verifyIrreversibleRunAuthorization,
} from "../../domain/browser_tests/irreversible_authorization";
import { runnerKindFromVersion } from "../../domain/browser_tests/runner_protocol";
import type {
  RunArtifact,
  RunSnapshot,
  RunStep,
  TestAttempt,
  TestRun,
} from "../../domain/browser_tests/types";
import { extractPlaceholders } from "../../domain/secrets/rules";
import type { ResolvedSecrets } from "../../domain/secrets/types";
import type { ArtifactStorage } from "../../infrastructure/storage/artifacts";
import { artifactStorageKey } from "../../infrastructure/storage/artifacts";
import type { Clock } from "../../shared/clock";
import {
  ATTEMPT_TIMEOUT_MS,
  FALLBACK_CLAIM_MIN_AGE_MS,
  MAX_AGENT_STEPS,
  MAX_CONSOLE_ENTRIES,
  MAX_NETWORK_ENTRIES,
  MAX_SCREENSHOTS_PER_ATTEMPT,
  RETENTION_DAYS,
  SCREENSHOT_JPEG_QUALITY,
} from "../../shared/constants";
import { AppError, validation } from "../../shared/errors";
import type { IdGenerator } from "../../shared/ids";
import { platformAlert } from "../../shared/log";
import { Redactor, sanitizeUrl, truncate } from "../../shared/redact";
import type { ResolveSecrets } from "../secrets/resolve_secrets";
import { buildRedactor } from "../secrets/resolve_secrets";
import {
  WORKER_LOST_GRACE_MS,
  type AttemptLifecycle,
  type AttemptOutcome,
} from "./attempt_lifecycle";

const DAY_MS = 86_400_000;
const MAX_SCREENSHOT_BYTES = 2_250_000;
const STALE_CLAIM_CANDIDATES = 5;

export interface ExternalRunnerJob {
  reference: RunnerAttemptReference;
  snapshot: RunSnapshot;
  limits: {
    attemptTimeoutMs: number;
    maxAgentSteps: number;
    maxScreenshotsPerAttempt: number;
    screenshotJpegQuality: number;
  };
}

export interface ExternalRunnerStart {
  startedAt: number;
  deadlineAt: number;
  secrets: Array<{
    key: string;
    value: string;
    allowedDomains: string[];
  }>;
}

export interface ExternalRunnerDependencies {
  lifecycle: Pick<
    AttemptLifecycle,
    "claim" | "markRunning" | "onAttemptFinished"
  >;
  runs: Pick<RunRepo, "findByIdForExecution" | "consumeActionAuthorization">;
  attempts: Pick<
    AttemptRepo,
    "findById" | "isRunnerDeliveryOwner" | "listExternallyClaimable"
  >;
  steps: Pick<StepRepo, "insertMany" | "listForAttempt">;
  artifacts: Pick<ArtifactRepo, "insert" | "deleteByIds">;
  storage: Pick<ArtifactStorage, "put" | "delete">;
  resolveSecrets: Pick<ResolveSecrets, "execute">;
  clock: Clock;
  ids: IdGenerator;
  authorizationSigningSecret: string;
}

interface AttemptState {
  run: TestRun;
  attempt: TestAttempt;
}

function isRunTerminal(run: TestRun): boolean {
  return (
    run.status === "PASSED" ||
    run.status === "FAILED" ||
    run.status === "TIMEOUT" ||
    run.status === "SYSTEM_ERROR"
  );
}

function messageReference(input: RunnerClaimInput): RunnerAttemptReference {
  return {
    runId: input.message.runId,
    attemptId: input.message.attemptId,
    attemptIndex: input.message.attemptIndex,
    executionGeneration: input.message.executionGeneration,
    deliveryId: input.deliveryId,
  };
}

function referenceMatches(
  reference: RunnerAttemptReference,
  run: TestRun | null,
  attempt: TestAttempt | null,
): run is TestRun {
  return (
    run !== null &&
    attempt !== null &&
    run.id === reference.runId &&
    attempt.id === reference.attemptId &&
    attempt.testRunId === reference.runId &&
    attempt.attemptIndex === reference.attemptIndex &&
    attempt.queuedAt === reference.executionGeneration
  );
}

function decodeJpeg(encoded: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(encoded);
  } catch {
    throw validation([
      { field: "step.screenshotJpegBase64", message: "Screenshot is not valid base64" },
    ]);
  }
  if (binary.length === 0 || binary.length > MAX_SCREENSHOT_BYTES) {
    throw validation([
      {
        field: "step.screenshotJpegBase64",
        message: "Screenshot must contain between 1 byte and 2.25 MB",
      },
    ]);
  }
  const bytes = Uint8Array.from(
    binary,
    (character) => character.charCodeAt(0),
  );
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    throw validation([
      { field: "step.screenshotJpegBase64", message: "Screenshot must be a JPEG" },
    ]);
  }
  return bytes;
}

function safeOptional(redactor: Redactor, value: string | undefined): string | undefined {
  return value === undefined ? undefined : truncate(redactor.redact(value), 2_000);
}

export class ExternalRunner {
  constructor(private readonly dependencies: ExternalRunnerDependencies) {}

  async claim(input: RunnerClaimInput): Promise<ExternalRunnerJob | null> {
    if (
      (await this.dependencies.lifecycle.claim(
        input.message,
        input.deliveryId,
        input.workerId,
      )) === "skip"
    ) {
      return null;
    }
    const reference = messageReference(input);
    const state = await this.state(reference);
    if (state === null || state.attempt.status !== "STARTING") return null;
    const snapshot = structuredClone(state.run.snapshot);
    const authorization = snapshot.irreversibleAuthorization;
    const authorizationValid =
      authorization !== undefined &&
      authorization.runId === state.run.id &&
      authorization.workspaceId === state.run.workspaceId &&
      authorization.approvedByUserId === state.run.triggeredByUserId &&
      (await verifyIrreversibleRunAuthorization(
        snapshot,
        this.dependencies.authorizationSigningSecret,
      ));
    if (!authorizationValid) delete snapshot.irreversibleAuthorization;
    return {
      reference,
      snapshot,
      limits: {
        attemptTimeoutMs: ATTEMPT_TIMEOUT_MS,
        maxAgentSteps: MAX_AGENT_STEPS,
        maxScreenshotsPerAttempt: MAX_SCREENSHOTS_PER_ATTEMPT,
        screenshotJpegQuality: SCREENSHOT_JPEG_QUALITY,
      },
    };
  }

  async authorizeAction(
    input: z.infer<typeof runnerAuthorizeActionSchema>,
  ): Promise<boolean> {
    const state = await this.state(input.reference);
    if (
      state === null ||
      state.run.status !== "RUNNING" ||
      state.attempt.status !== "RUNNING"
    ) {
      return false;
    }
    const authorization = state.run.snapshot.irreversibleAuthorization;
    if (
      authorization === undefined ||
      authorization.runId !== state.run.id ||
      authorization.workspaceId !== state.run.workspaceId ||
      authorization.approvedByUserId !== state.run.triggeredByUserId ||
      !(await verifyIrreversibleRunAuthorization(
        state.run.snapshot,
        this.dependencies.authorizationSigningSecret,
      )) ||
      !authorization.scopes.some((scope) =>
        actionMatchesScope(input.action, scope),
      )
    ) {
      return false;
    }
    const consumed = await this.dependencies.runs.consumeActionAuthorization(
      state.run.id,
      input.action,
    );
    if (consumed) {
      platformAlert("browser_irreversible_action_authorized", {
        runId: state.run.id,
        attemptId: state.attempt.id,
        kind: input.action.kind,
        origin: input.action.origin,
        path: input.action.path,
        operation:
          input.action.kind === "HTTP"
            ? input.action.method
            : input.action.action,
      });
    }
    return consumed;
  }

  async claimStale(input: {
    deliveryId: string;
    workerId: string;
  }): Promise<ExternalRunnerJob | null> {
    const now = this.dependencies.clock.now();
    // Also surface abandoned STARTING/RUNNING attempts: claiming them runs
    // the same WORKER_LOST recovery a queue redelivery would trigger, so the
    // fallback keeps the system healing even while the local worker is down.
    const candidates = await this.dependencies.attempts.listExternallyClaimable(
      now - FALLBACK_CLAIM_MIN_AGE_MS,
      now - ATTEMPT_TIMEOUT_MS - WORKER_LOST_GRACE_MS,
      STALE_CLAIM_CANDIDATES,
    );
    for (const candidate of candidates) {
      const job = await this.claim({
        deliveryId: input.deliveryId,
        workerId: input.workerId,
        message: {
          kind: "attempt",
          runId: candidate.testRunId,
          attemptId: candidate.id,
          attemptIndex: candidate.attemptIndex,
          executionGeneration: candidate.queuedAt,
        },
      });
      if (job !== null) return job;
    }
    return null;
  }

  async start(
    reference: RunnerAttemptReference,
  ): Promise<ExternalRunnerStart | null> {
    let state = await this.state(reference);
    if (state === null || isRunTerminal(state.run)) return null;
    let newlyStarted = false;
    if (state.attempt.status === "STARTING") {
      await this.dependencies.lifecycle.markRunning(
        reference.runId,
        reference.attemptId,
        reference.attemptIndex,
        reference.executionGeneration,
      );
      state = await this.state(reference);
      newlyStarted = true;
    }
    if (
      state === null ||
      state.attempt.status !== "RUNNING" ||
      state.attempt.startedAt === null
    ) {
      return null;
    }
    // Secret material is a one-response lease. Replaying the job capability
    // may resume an already running attempt, but it never releases the values
    // a second time.
    const secrets = newlyStarted
      ? await this.secretsForRun(state.run)
      : new Map();
    return {
      startedAt: state.attempt.startedAt,
      deadlineAt: state.attempt.startedAt + ATTEMPT_TIMEOUT_MS,
      secrets: [...secrets].map(([key, secret]) => ({
        key,
        value: secret.value,
        allowedDomains: [...secret.allowedDomains],
      })),
    };
  }

  async recordStep(input: RunnerStepInput): Promise<boolean> {
    const state = await this.state(input.reference);
    if (
      state === null ||
      isRunTerminal(state.run) ||
      state.attempt.status !== "RUNNING"
    ) {
      return false;
    }

    const existingSteps = await this.dependencies.steps.listForAttempt(
      state.attempt.id,
    );
    if (
      existingSteps.some((candidate) => candidate.sequence === input.step.sequence)
    ) {
      return true;
    }
    const nextSequence = (existingSteps.at(-1)?.sequence ?? 0) + 1;
    if (input.step.sequence !== nextSequence) {
      throw new AppError(
        "CONFLICT",
        `Expected step sequence ${nextSequence}`,
      );
    }

    const secrets = await this.secretsForRun(state.run);
    const redactor = buildRedactor(secrets);
    const now = this.dependencies.clock.now();
    const screenshot =
      secrets.size > 0 || input.step.screenshotJpegBase64 === undefined ||
        input.step.screenshotJpegBase64 === null
        ? null
        : decodeJpeg(input.step.screenshotJpegBase64);
    if (secrets.size > 0 && input.step.screenshotJpegBase64 != null) {
      platformAlert("external_runner_screenshot_discarded", {
        runId: state.run.id,
        attemptId: state.attempt.id,
      });
    }

    let artifact: RunArtifact | null = null;
    if (screenshot !== null) {
      artifact = await this.storeScreenshot(
        state.run,
        state.attempt,
        input.step.sequence,
        screenshot,
        now,
      );
    }
    const step: RunStep = {
      id: this.dependencies.ids.newId("step"),
      attemptId: state.attempt.id,
      sequence: input.step.sequence,
      timestamp: now,
      actionType: truncate(redactor.redact(input.step.actionType), 80),
      description: truncate(redactor.redact(input.step.description), 2_000),
      urlSanitized:
        input.step.url === null
          ? null
          : redactor.redact(sanitizeUrl(input.step.url)),
      result: input.step.result,
      artifactId: artifact?.id ?? null,
      createdAt: now,
    };
    try {
      await this.dependencies.steps.insertMany([step]);
    } catch (error) {
      if (artifact !== null) {
        await Promise.allSettled([
          this.dependencies.artifacts.deleteByIds([artifact.id]),
          this.dependencies.storage.delete([artifact.storageKey]),
        ]);
      }
      const afterFailure = await this.dependencies.steps.listForAttempt(
        state.attempt.id,
      );
      if (
        afterFailure.some(
          (candidate) => candidate.sequence === input.step.sequence,
        )
      ) {
        return true;
      }
      throw error;
    }
    return true;
  }

  async complete(
    reference: RunnerAttemptReference,
    input: RunnerOutcomeInput,
  ): Promise<boolean> {
    const state = await this.state(reference);
    if (state === null) return false;
    if (state.attempt.finishedAt !== null || isRunTerminal(state.run)) {
      return true;
    }
    if (
      state.attempt.status !== "STARTING" &&
      state.attempt.status !== "RUNNING"
    ) {
      return false;
    }
    const secrets = await this.secretsForRun(state.run);
    const redactor = buildRedactor(secrets);
    const outcome: AttemptOutcome = {
      status: input.status,
      summary: safeOptional(redactor, input.summary),
      expectedResult: safeOptional(redactor, input.expectedResult),
      actualResult: safeOptional(redactor, input.actualResult),
      failureReason: safeOptional(redactor, input.failureReason),
      systemErrorCode: safeOptional(redactor, input.systemErrorCode),
      tokenUsage: input.tokenUsage,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      modelName: truncate(redactor.redact(input.modelName), 200),
      runnerVersion: truncate(redactor.redact(input.runnerVersion), 200),
      runnerKind:
        input.runnerKind ?? runnerKindFromVersion(input.runnerVersion) ?? undefined,
      visitedUrls: input.visitedUrls.map((url) =>
        redactor.redact(sanitizeUrl(url)),
      ),
      consoleErrors: redactor
        .redactDeep(input.consoleErrors)
        .slice(0, MAX_CONSOLE_ENTRIES),
      networkErrors: redactor
        .redactDeep(input.networkErrors)
        .slice(0, MAX_NETWORK_ENTRIES),
    };
    await this.dependencies.lifecycle.onAttemptFinished(
      state.run,
      state.attempt,
      outcome,
    );
    return true;
  }

  private async state(
    reference: RunnerAttemptReference,
  ): Promise<AttemptState | null> {
    const [run, attempt, ownsDelivery] = await Promise.all([
      this.dependencies.runs.findByIdForExecution(reference.runId),
      this.dependencies.attempts.findById(reference.attemptId),
      this.dependencies.attempts.isRunnerDeliveryOwner(
        reference.attemptId,
        reference.deliveryId,
      ),
    ]);
    if (
      !ownsDelivery ||
      !referenceMatches(reference, run, attempt) ||
      attempt === null
    ) {
      return null;
    }
    return { run, attempt };
  }

  private secretsForRun(run: TestRun): Promise<ResolvedSecrets> {
    return this.dependencies.resolveSecrets.execute({
      workspaceId: run.workspaceId,
      referencedKeys: extractPlaceholders(
        `${run.snapshot.instructions} ${run.snapshot.startUrl}`,
      ),
    });
  }

  private async storeScreenshot(
    run: TestRun,
    attempt: TestAttempt,
    sequence: number,
    screenshot: Uint8Array,
    now: number,
  ): Promise<RunArtifact> {
    const artifactId = this.dependencies.ids.newId("art");
    const storageKey = artifactStorageKey({
      workspaceId: run.workspaceId,
      runId: run.id,
      attemptId: attempt.id,
      artifactId,
      type: "SCREENSHOT",
    });
    const stored = await this.dependencies.storage.put(
      storageKey,
      screenshot,
      "image/jpeg",
    );
    const artifact: RunArtifact = {
      id: artifactId,
      workspaceId: run.workspaceId,
      runId: run.id,
      attemptId: attempt.id,
      type: "SCREENSHOT",
      storageKey,
      mimeType: "image/jpeg",
      sizeBytes: stored.sizeBytes,
      metadataJson: JSON.stringify({ sequence }),
      createdAt: now,
      expiresAt: now + RETENTION_DAYS * DAY_MS,
    };
    try {
      await this.dependencies.artifacts.insert(artifact);
    } catch (error) {
      await this.dependencies.storage.delete([storageKey]).catch(() => undefined);
      throw error;
    }
    return artifact;
  }
}
