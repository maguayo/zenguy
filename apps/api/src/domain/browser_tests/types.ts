export type Device = "DESKTOP" | "MOBILE";
export type RunSource = "VALIDATION" | "MANUAL" | "SCHEDULED";
export type RunStatus =
  | "QUEUED"
  | "RUNNING"
  | "PASSED"
  | "FAILED"
  | "TIMEOUT"
  | "SYSTEM_ERROR";
export type AttemptStatus =
  | "QUEUED"
  | "STARTING"
  | "RUNNING"
  | "PASSED"
  | "FAILED"
  | "TIMEOUT"
  | "SYSTEM_ERROR";
export type StepResult = "OK" | "ERROR";
export type ArtifactType = "SCREENSHOT" | "MARKDOWN_REPORT";

export interface RunSnapshot {
  name: string;
  startUrl: string;
  instructions: string;
  device: Device;
  intervalHours: number;
  maxRetries: number;
  notifyOnRecovery: boolean;
  channelIds: string[];
  viewport: { width: number; height: number };
  modelName: string;
  runnerVersion: string;
}

export interface BrowserTest {
  id: string;
  workspaceId: string;
  name: string;
  startUrl: string;
  instructions: string;
  device: Device;
  intervalHours: number;
  maxRetries: number;
  notifyOnRecovery: boolean;
  nextRunAt: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface ClaimedBrowserTest extends BrowserTest {
  scheduledFor: number;
}

export interface TestRun {
  id: string;
  workspaceId: string;
  browserTestId: string | null;
  source: RunSource;
  status: RunStatus;
  snapshot: RunSnapshot;
  scheduledFor: number | null;
  queuedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  durationMs: number | null;
  attemptCount: number;
  infraAttempts: number;
  passedAfterRetry: boolean;
  billable: boolean;
  usageEventId: string | null;
  triggeredByUserId: string | null;
  incidentId: string | null;
  createdAt: number;
}

export interface TestAttempt {
  id: string;
  testRunId: string;
  attemptIndex: number;
  status: AttemptStatus;
  retryDelaySeconds: number;
  queuedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  durationMs: number | null;
  summary: string | null;
  expectedResult: string | null;
  actualResult: string | null;
  failureReason: string | null;
  visitedUrlsJson: string | null;
  consoleErrorsJson: string | null;
  networkErrorsJson: string | null;
  tokenUsage: number | null;
  modelName: string | null;
  runnerVersion: string | null;
  systemErrorCode: string | null;
  createdAt: number;
}

export interface RunStep {
  id: string;
  attemptId: string;
  sequence: number;
  timestamp: number;
  actionType: string;
  description: string;
  urlSanitized: string | null;
  result: StepResult;
  artifactId: string | null;
  createdAt: number;
}

export interface RunArtifact {
  id: string;
  workspaceId: string;
  runId: string;
  attemptId: string | null;
  type: ArtifactType;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  metadataJson: string | null;
  createdAt: number;
  expiresAt: number;
}

export interface RunSummaryRow {
  browserTestId: string;
  id: string;
  source: RunSource;
  status: RunStatus;
  startedAt: number | null;
  finishedAt: number | null;
  durationMs: number | null;
  attemptCount: number;
  passedAfterRetry: boolean;
  billable: boolean;
  createdAt: number;
}
