import type { AttemptLifecycle, AttemptOutcome } from "./attempt_lifecycle";
import {
  agentTimeoutResult,
  navigateWithSecrets,
  runAgentAttempt,
  type StepRecord,
} from "./run_agent";
import type {
  ArtifactRepo,
  AttemptRepo,
  RunRepo,
  StepRepo,
} from "../../domain/browser_tests/repo";
import type {
  Device,
  RunArtifact,
  RunStep,
  TestAttempt,
  TestRun,
} from "../../domain/browser_tests/types";
import type { LlmClient } from "../../domain/browser_tests/agent_types";
import { extractPlaceholders } from "../../domain/secrets/rules";
import type { ResolvedSecrets } from "../../domain/secrets/types";
import type { AttemptMessage } from "../../domain/queues";
import type { ResolveSecrets } from "../secrets/resolve_secrets";
import { buildRedactor } from "../secrets/resolve_secrets";
import type { BrowserSession } from "../../infrastructure/browser/session";
import { ActionError } from "../../infrastructure/browser/session";
import { LlmUnavailableError } from "../../infrastructure/llm/openai";
import type { ArtifactStorage } from "../../infrastructure/storage/artifacts";
import { artifactStorageKey } from "../../infrastructure/storage/artifacts";
import type { Clock } from "../../shared/clock";
import {
  ATTEMPT_TIMEOUT_MS,
  MAX_CONSOLE_ENTRIES,
  MAX_NETWORK_ENTRIES,
  RETENTION_DAYS,
  RUNNER_VERSION,
} from "../../shared/constants";
import type { IdGenerator } from "../../shared/ids";
import { logEvent, platformAlert } from "../../shared/log";
import { Redactor, sanitizeUrl, truncate } from "../../shared/redact";

const HARD_TIMEOUT_GRACE_MS = 10_000;
const MAX_VISITED_URLS = 100;
const DAY_MS = 86_400_000;

type HardTimeoutWait = (
  milliseconds: number,
  signal: AbortSignal,
) => Promise<void>;

export interface ExecuteAttemptDependencies {
  lifecycle: Pick<
    AttemptLifecycle,
    "claim" | "markRunning" | "onAttemptFinished"
  >;
  runs: Pick<RunRepo, "findByIdForExecution">;
  attempts: Pick<AttemptRepo, "findById">;
  steps: Pick<StepRepo, "insertMany">;
  artifacts: Pick<ArtifactRepo, "insert">;
  storage: Pick<ArtifactStorage, "put" | "delete">;
  resolveSecrets: Pick<ResolveSecrets, "execute">;
  launchSession: (device: Device) => Promise<BrowserSession>;
  llm: LlmClient;
  llmUseVision: boolean;
  clock: Clock;
  ids: IdGenerator;
  waitForHardTimeout?: HardTimeoutWait;
}

interface CollectedEvidence {
  visitedUrls: string[];
  consoleErrors: unknown[];
  networkErrors: unknown[];
}

function defaultHardTimeoutWait(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", cancelled);
      resolve();
    }, milliseconds);
    const cancelled = (): void => {
      clearTimeout(timeout);
      reject(new Error("Hard timeout cancelled"));
    };
    signal.addEventListener("abort", cancelled, { once: true });
  });
}

function emptyEvidence(): CollectedEvidence {
  return { visitedUrls: [], consoleErrors: [], networkErrors: [] };
}

function safeText(redactor: Redactor, value: string): string {
  return truncate(redactor.redact(value), 2_000);
}

function safeCurrentUrl(
  session: BrowserSession,
  redactor: Redactor,
): string | null {
  const current = session.currentUrl();
  return current.length === 0
    ? null
    : redactor.redact(sanitizeUrl(current));
}

function systemOutcome(
  code: "BROWSER_LAUNCH_FAILED" | "LLM_UNAVAILABLE" | "RUNNER_CRASH",
  redactor: Redactor,
): Omit<AttemptOutcome, "visitedUrls" | "consoleErrors" | "networkErrors"> {
  const copy =
    code === "BROWSER_LAUNCH_FAILED"
      ? {
          summary: "Browser session failed to launch",
          failureReason: "The browser service could not start a clean session",
        }
      : code === "LLM_UNAVAILABLE"
        ? {
            summary: "Language model provider unavailable",
            failureReason: "The language model provider was unavailable",
          }
        : {
            summary: "Attempt runner stopped unexpectedly",
            failureReason: "The runner encountered an internal error",
          };
  return {
    status: "SYSTEM_ERROR",
    systemErrorCode: code,
    summary: safeText(redactor, copy.summary),
    failureReason: safeText(redactor, copy.failureReason),
  };
}

function requiredExecutionState(
  run: TestRun | null,
  attempt: TestAttempt | null,
  message: AttemptMessage,
): { run: TestRun; attempt: TestAttempt } | null {
  if (
    run === null ||
    attempt === null ||
    attempt.testRunId !== message.runId ||
    attempt.attemptIndex !== message.attemptIndex
  ) {
    platformAlert("attempt_state_missing_after_claim", {
      runId: message.runId,
      attemptId: message.attemptId,
    });
    return null;
  }
  return { run, attempt };
}

function capAndRedactEvidence(
  evidence: CollectedEvidence,
  redactor: Redactor,
): CollectedEvidence {
  const safe = redactor.redactDeep(evidence);
  return {
    visitedUrls: safe.visitedUrls.slice(0, MAX_VISITED_URLS),
    consoleErrors: safe.consoleErrors.slice(0, MAX_CONSOLE_ENTRIES),
    networkErrors: safe.networkErrors.slice(0, MAX_NETWORK_ENTRIES),
  };
}

export class ExecuteAttempt {
  constructor(private readonly dependencies: ExecuteAttemptDependencies) {}

  async execute(
    message: AttemptMessage,
    _context?: ExecutionContext,
  ): Promise<void> {
    if ((await this.dependencies.lifecycle.claim(message)) === "skip") return;

    const state = requiredExecutionState(
      await this.dependencies.runs.findByIdForExecution(message.runId),
      await this.dependencies.attempts.findById(message.attemptId),
      message,
    );
    if (state === null) return;

    let redactor = new Redactor([]);
    let session: BrowserSession | null = null;
    let evidence = emptyEvidence();
    let tokensUsed = 0;
    let outcome: Omit<
      AttemptOutcome,
      "visitedUrls" | "consoleErrors" | "networkErrors"
    > = systemOutcome("RUNNER_CRASH", redactor);
    const persistedSteps: StepRecord[] = [];

    try {
      const secrets = await this.dependencies.resolveSecrets.execute({
        workspaceId: state.run.workspaceId,
        referencedKeys: extractPlaceholders(
          `${state.run.snapshot.instructions} ${state.run.snapshot.startUrl}`,
        ),
      });
      redactor = buildRedactor(secrets);

      try {
        session = await this.dependencies.launchSession(
          state.run.snapshot.device,
        );
      } catch {
        platformAlert("browser_launch_failed", {
          runId: state.run.id,
          attemptId: state.attempt.id,
        });
        outcome = systemOutcome("BROWSER_LAUNCH_FAILED", redactor);
      }

      if (session !== null) {
        await this.dependencies.lifecycle.markRunning(
          message.runId,
          message.attemptId,
          message.attemptIndex,
        );
        const runningAttempt = await this.dependencies.attempts.findById(
          message.attemptId,
        );
        if (runningAttempt?.startedAt === null || runningAttempt === null) {
          throw new Error("Running attempt state missing");
        }

        const persist = async (step: StepRecord): Promise<void> => {
          await this.persistStep(state.run, state.attempt, step);
          persistedSteps.push({
            ...step,
            screenshotJpeg:
              step.screenshotJpeg === null
                ? null
                : new Uint8Array(step.screenshotJpeg),
          });
        };
        const initialStep = await this.initialNavigationStep(
          session,
          state.run,
          secrets,
          redactor,
        );
        await persist(initialStep);

        let hardTimedOut = false;
        const trackedLlm: LlmClient = {
          decideAction: async (input) => {
            const decision = await this.dependencies.llm.decideAction(input);
            tokensUsed += decision.tokensUsed;
            return decision;
          },
        };
        const timeoutController = new AbortController();
        const hardTimeoutAt =
          runningAttempt.startedAt +
          ATTEMPT_TIMEOUT_MS +
          HARD_TIMEOUT_GRACE_MS;
        const waitForHardTimeout =
          this.dependencies.waitForHardTimeout ?? defaultHardTimeoutWait;
        const hardTimeout = waitForHardTimeout(
          Math.max(0, hardTimeoutAt - this.dependencies.clock.now()),
          timeoutController.signal,
        ).then(async () => {
          hardTimedOut = true;
          try {
            await session?.dispose();
          } catch {
            // A hard timeout must stay TIMEOUT even if cleanup also fails.
          }
          return agentTimeoutResult(
            state.run.snapshot,
            persistedSteps,
            tokensUsed,
            redactor,
          );
        });
        try {
          const result = await Promise.race([
            runAgentAttempt(
              {
                session,
                llm: trackedLlm,
                clock: this.dependencies.clock,
                redactor,
                secrets,
                llmUseVision: this.dependencies.llmUseVision,
                onStep: async (step) => {
                  if (!hardTimedOut) await persist(step);
                },
              },
              {
                snapshot: state.run.snapshot,
                deadlineAt:
                  runningAttempt.startedAt + ATTEMPT_TIMEOUT_MS,
                initialSteps: [initialStep],
              },
            ),
            hardTimeout,
          ]);
          tokensUsed = result.tokensUsed;
          outcome = {
            status: result.status,
            summary: result.summary,
            expectedResult: result.expectedResult,
            actualResult: result.actualResult,
            ...(result.failureReason === null
              ? {}
              : { failureReason: result.failureReason }),
            tokenUsage: tokensUsed,
          };
        } finally {
          timeoutController.abort();
        }
      }
    } catch (error) {
      if (error instanceof LlmUnavailableError) {
        platformAlert("llm_unavailable", {
          runId: state.run.id,
          attemptId: state.attempt.id,
        });
        outcome = {
          ...systemOutcome("LLM_UNAVAILABLE", redactor),
          tokenUsage: tokensUsed,
        };
      } else {
        platformAlert("attempt_runner_crash", {
          runId: state.run.id,
          attemptId: state.attempt.id,
        });
        outcome = {
          ...systemOutcome("RUNNER_CRASH", redactor),
          tokenUsage: tokensUsed,
        };
      }
    } finally {
      if (session !== null) {
        try {
          evidence = session.collected();
        } catch {
          platformAlert("browser_evidence_collection_failed", {
            runId: state.run.id,
            attemptId: state.attempt.id,
          });
        }
        try {
          await session.dispose();
        } catch {
          // BrowserSession promises best-effort disposal; preserve that contract
          // for injected implementations as well.
        }
      }
    }

    const safeEvidence = capAndRedactEvidence(evidence, redactor);
    logEvent("attempt_tokens", {
      attemptId: state.attempt.id,
      tokens: tokensUsed,
    });
    await this.dependencies.lifecycle.onAttemptFinished(
      state.run,
      state.attempt,
      {
        ...outcome,
        tokenUsage: outcome.tokenUsage ?? tokensUsed,
        modelName: state.run.snapshot.modelName,
        runnerVersion: RUNNER_VERSION,
        ...safeEvidence,
      },
    );
  }

  private async initialNavigationStep(
    session: BrowserSession,
    run: TestRun,
    secrets: ResolvedSecrets,
    redactor: Redactor,
  ): Promise<StepRecord> {
    let result: "OK" | "ERROR" = "OK";
    let error: string | null = null;
    try {
      const navigation = await navigateWithSecrets(
        session,
        run.snapshot.startUrl,
        secrets,
      );
      if (!navigation.ok) {
        result = "ERROR";
        error = navigation.error;
      }
    } catch (cause) {
      result = "ERROR";
      error =
        cause instanceof ActionError || cause instanceof Error
          ? cause.message
          : "Initial navigation failed";
    }
    const screenshot = await session.screenshotJpeg();
    const baseDescription = `Initial navigation → navigate to ${sanitizeUrl(run.snapshot.startUrl)}`;
    return {
      sequence: 1,
      timestamp: this.dependencies.clock.now(),
      actionType: "navigate",
      description: safeText(
        redactor,
        error === null ? baseDescription : `${baseDescription} — ${error}`,
      ),
      urlSanitized: safeCurrentUrl(session, redactor),
      result,
      screenshotJpeg: screenshot,
    };
  }

  private async persistStep(
    run: TestRun,
    attempt: TestAttempt,
    step: StepRecord,
  ): Promise<void> {
    const now = this.dependencies.clock.now();
    let artifact: RunArtifact | null = null;
    if (step.screenshotJpeg !== null) {
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
        step.screenshotJpeg,
        "image/jpeg",
      );
      artifact = {
        id: artifactId,
        workspaceId: run.workspaceId,
        runId: run.id,
        attemptId: attempt.id,
        type: "SCREENSHOT",
        storageKey,
        mimeType: "image/jpeg",
        sizeBytes: stored.sizeBytes,
        metadataJson: JSON.stringify({ sequence: step.sequence }),
        createdAt: now,
        expiresAt: now + RETENTION_DAYS * DAY_MS,
      };
      try {
        await this.dependencies.artifacts.insert(artifact);
      } catch (error) {
        await this.dependencies.storage.delete([storageKey]).catch(() => undefined);
        throw error;
      }
    }

    const row: RunStep = {
      id: this.dependencies.ids.newId("step"),
      attemptId: attempt.id,
      sequence: step.sequence,
      timestamp: step.timestamp,
      actionType: step.actionType,
      description: step.description,
      urlSanitized: step.urlSanitized,
      result: step.result,
      artifactId: artifact?.id ?? null,
      createdAt: now,
    };
    await this.dependencies.steps.insertMany([row]);
  }
}
