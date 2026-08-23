import type {
  AttemptStatus,
  Device,
  RunSnapshot,
  RunSource,
  RunStatus,
  StepResult,
  RunnerKind,
} from "../../domain/browser_tests/types";

export type UserRefOutput = { userId: string; name: string } | null;

export interface RunListItemOutput {
  id: string;
  createdAt: number;
  source: RunSource;
  status: RunStatus;
  durationMs: number | null;
  device: Device;
  attemptCount: number;
  passedAfterRetry: boolean;
  billable: boolean;
  triggeredBy: UserRefOutput;
}

export interface AttemptSummaryOutput {
  id: string;
  attemptIndex: number;
  status: AttemptStatus;
  retryDelaySeconds: number;
  queuedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  durationMs: number | null;
  summary: string | null;
  failureReason: string | null;
  tokenUsage: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  modelName: string | null;
  runnerKind: RunnerKind | null;
  runnerVersion: string | null;
  latestStep: {
    description: string;
    actionType: string;
    timestamp: number;
  } | null;
  latestScreenshot: { id: string; url: string } | null;
}

export interface RunDetailOutput {
  id: string;
  testId: string | null;
  source: RunSource;
  status: RunStatus;
  snapshot: RunSnapshot;
  scheduledFor: number | null;
  queuedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  durationMs: number | null;
  attemptCount: number;
  passedAfterRetry: boolean;
  billable: boolean;
  incidentId: string | null;
  triggeredBy: UserRefOutput;
  attempts: AttemptSummaryOutput[];
  live: { url: string } | null;
}

export interface ArtifactRefOutput {
  id: string;
  url: string;
  expiresAt: number;
}

export interface StepOutput {
  sequence: number;
  timestamp: number;
  actionType: string;
  description: string;
  urlSanitized: string | null;
  result: StepResult;
  screenshot: ArtifactRefOutput | null;
}

export interface ConsoleErrorOutput {
  level: string;
  message: string;
  url: string | null;
  timestamp: string;
}

export interface NetworkErrorOutput {
  method: string;
  host: string;
  path: string;
  statusCode: number | null;
  errorType: string | null;
  durationMs: number | null;
}

export interface AttemptDetailOutput extends AttemptSummaryOutput {
  expectedResult: string | null;
  actualResult: string | null;
  systemErrorCode: string | null;
  visitedUrls: string[];
  consoleErrors: ConsoleErrorOutput[];
  networkErrors: NetworkErrorOutput[];
  steps: StepOutput[];
  screenshots: ArtifactRefOutput[];
}
