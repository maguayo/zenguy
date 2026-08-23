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

export type IrreversibleActionScope =
  | {
      kind: "DOM";
      action: "CLICK";
      origin: string;
      path: string;
      target: {
        attribute: "data-testid" | "id" | "name" | "aria-label";
        value: string;
        tag: "BUTTON" | "INPUT";
        type: "submit";
        form: {
          method: "POST";
          origin: string;
          path: string;
        };
      };
      maxUses: number;
    }
  | {
      kind: "HTTP";
      method: "POST" | "PUT" | "PATCH" | "DELETE";
      origin: string;
      path: string;
      maxUses: number;
    };

export type IrreversibleActionRequest =
  | Omit<Extract<IrreversibleActionScope, { kind: "DOM" }>, "maxUses">
  | Omit<Extract<IrreversibleActionScope, { kind: "HTTP" }>, "maxUses">;

export interface IrreversibleRunAuthorization {
  version: 2;
  runId: string;
  workspaceId: string;
  originalInstructionsSha256: string;
  testDataAttested: true;
  approvedByUserId: string;
  approvedAt: number;
  scopes: IrreversibleActionScope[];
  signature: string;
}

export interface ActionAuthorizationState {
  scope: IrreversibleActionScope;
  remainingUses: number;
}

export interface RunSnapshot {
  name: string;
  /** Absent on immutable runs created before browser-policy version 1. */
  allowedDomains?: string[];
  /**
   * Exact hosts where local form-state interactions are authorized. Absent
   * means read-only for legacy immutable snapshots.
   */
  writableDomains?: string[];
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
  /** Present only after an explicit per-run human confirmation. */
  irreversibleAuthorization?: IrreversibleRunAuthorization;
}

export interface BrowserTest {
  id: string;
  workspaceId: string;
  name: string;
  /** Repositories normalize migrated rows; optional only for legacy fixtures. */
  allowedDomains?: string[];
  /** Exact, non-wildcard hosts authorized for local form-state interactions. */
  writableDomains?: string[];
  /** Explicit statement that credentials and data are staging/test-only. */
  testDataAttested?: boolean;
  /** Exact capabilities; inert until separately approved for one run. */
  irreversibleActionScopes?: IrreversibleActionScope[];
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
  /** Mutable one-shot ledger, kept outside the immutable signed snapshot. */
  actionAuthorizations?: ActionAuthorizationState[];
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
  inputTokens: number | null;
  outputTokens: number | null;
  modelName: string | null;
  runnerVersion: string | null;
  runnerKind: RunnerKind | null;
  systemErrorCode: string | null;
  createdAt: number;
}

/** Which executor ran an attempt: the primary queue-driven worker or the plan-B fallback runner. */
export type RunnerKind = "primary" | "fallback";

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

export interface LatestStepSummary {
  description: string;
  actionType: string;
  timestamp: number;
}

export interface LatestScreenshotSummary {
  id: string;
}

export interface AttemptWithLatest {
  attempt: TestAttempt;
  latestStep: LatestStepSummary | null;
  latestScreenshot: LatestScreenshotSummary | null;
}

/** One recent run result for a history strip; lists are oldest first. */
export interface RunTick {
  id: string;
  status: RunStatus;
  finishedAt: number | null;
}
