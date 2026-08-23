import {
  INFRA_RETRY_DELAY_SECONDS,
  MAX_INFRA_RETRIES,
  RETRY_DELAY_SECONDS,
} from "../../shared/constants";
import type { RunSource, RunStatus } from "./types";

export type FunctionalAttemptStatus = "FAILED" | "TIMEOUT";
export type AttemptOutcomeStatus =
  | "PASSED"
  | FunctionalAttemptStatus
  | "SYSTEM_ERROR";

export type NextAction =
  | { kind: "retry"; nextIndex: number; delaySeconds: number }
  | { kind: "infra_retry"; delaySeconds: number }
  | {
      kind: "finalize";
      runStatus: RunStatus;
      passedAfterRetry: boolean;
      reverseUsage: boolean;
    };

function finalize(
  runStatus: RunStatus,
  passedAfterRetry = false,
  reverseUsage = false,
): NextAction {
  return {
    kind: "finalize",
    runStatus,
    passedAfterRetry,
    reverseUsage,
  };
}

export function decideAfterAttempt(input: {
  attemptIndex: number;
  attemptStatus: AttemptOutcomeStatus;
  maxRetries: number;
  infraAttempts: number;
  priorFunctionalStatuses: readonly FunctionalAttemptStatus[];
  anyAttemptEverStarted: boolean;
}): NextAction {
  if (input.attemptStatus === "PASSED") {
    return finalize("PASSED", input.attemptIndex > 0);
  }
  if (
    input.attemptStatus === "FAILED" ||
    input.attemptStatus === "TIMEOUT"
  ) {
    if (input.attemptIndex < input.maxRetries) {
      const nextIndex = input.attemptIndex + 1;
      const delaySeconds = RETRY_DELAY_SECONDS[nextIndex];
      if (delaySeconds === undefined) {
        throw new Error(`Unsupported retry index: ${nextIndex}`);
      }
      return { kind: "retry", nextIndex, delaySeconds };
    }
    return finalize(input.attemptStatus);
  }
  if (input.infraAttempts < MAX_INFRA_RETRIES) {
    return { kind: "infra_retry", delaySeconds: INFRA_RETRY_DELAY_SECONDS };
  }
  const priorFunctionalStatus = input.priorFunctionalStatuses.at(-1);
  if (priorFunctionalStatus !== undefined) {
    return finalize(priorFunctionalStatus);
  }
  return finalize("SYSTEM_ERROR", false, !input.anyAttemptEverStarted);
}

export function runStatusOnStart(): "RUNNING" {
  return "RUNNING";
}

/**
 * Wall-clock duration of a run from the moment its first attempt started
 * (retry delays included, the initial queue wait excluded). Callers fall back
 * to `queuedAt` only for runs that never started.
 */
export function computeRunDuration(
  startedAt: number,
  finishedAt: number,
): number {
  return Math.max(0, finishedAt - startedAt);
}

export function shouldGenerateReport(status: RunStatus): boolean {
  return status === "FAILED" || status === "TIMEOUT";
}

export function shouldOpenIncident(input: {
  runStatus: RunStatus;
  source: RunSource;
  hasTest: boolean;
}): boolean {
  return (
    input.hasTest &&
    input.source !== "VALIDATION" &&
    (input.runStatus === "FAILED" || input.runStatus === "TIMEOUT")
  );
}

export function shouldResolveIncident(status: RunStatus): boolean {
  return status === "PASSED";
}
