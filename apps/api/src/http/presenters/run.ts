import type {
  ArtifactRefOutput,
  AttemptDetailOutput,
  AttemptSummaryOutput,
  RunDetailOutput,
  RunListItemOutput,
} from "../../application/browser_tests/run_models";

function iso(value: number): string {
  return new Date(value).toISOString();
}

function nullableIso(value: number | null): string | null {
  return value === null ? null : iso(value);
}

function presentAttemptSummary(attempt: AttemptSummaryOutput) {
  return {
    ...attempt,
    queuedAt: iso(attempt.queuedAt),
    startedAt: nullableIso(attempt.startedAt),
    finishedAt: nullableIso(attempt.finishedAt),
    latestStep:
      attempt.latestStep === null
        ? null
        : { ...attempt.latestStep, timestamp: iso(attempt.latestStep.timestamp) },
  };
}

function presentArtifact(artifact: ArtifactRefOutput) {
  return { ...artifact, expiresAt: iso(artifact.expiresAt) };
}

export function presentRunListItem(run: RunListItemOutput) {
  return { ...run, createdAt: iso(run.createdAt) };
}

export function presentRun(run: RunDetailOutput) {
  return {
    ...run,
    scheduledFor: nullableIso(run.scheduledFor),
    queuedAt: iso(run.queuedAt),
    startedAt: nullableIso(run.startedAt),
    finishedAt: nullableIso(run.finishedAt),
    attempts: run.attempts.map(presentAttemptSummary),
  };
}

export function presentAttempt(attempt: AttemptDetailOutput) {
  return {
    ...presentAttemptSummary(attempt),
    steps: attempt.steps.map((step) => ({
      ...step,
      timestamp: iso(step.timestamp),
      screenshot:
        step.screenshot === null ? null : presentArtifact(step.screenshot),
    })),
    screenshots: attempt.screenshots.map(presentArtifact),
  };
}
