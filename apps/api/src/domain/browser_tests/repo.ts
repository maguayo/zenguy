import type { Cursor } from "../../shared/pagination";
import type { UsageEvent } from "../billing/types";
import type {
  ArtifactType,
  AttemptStatus,
  AttemptWithLatest,
  BrowserTest,
  ClaimedBrowserTest,
  Device,
  RunArtifact,
  RunStatus,
  RunStep,
  RunSummaryRow,
  RunTick,
  TestAttempt,
  TestRun,
  RunnerKind,
  IrreversibleActionRequest,
} from "./types";

export interface BrowserTestUpdate {
  name?: string;
  allowedDomains?: string[];
  writableDomains?: string[];
  testDataAttested?: boolean;
  irreversibleActionScopes?: BrowserTest["irreversibleActionScopes"];
  startUrl?: string;
  instructions?: string;
  device?: Device;
  intervalHours?: number;
  maxRetries?: number;
  notifyOnRecovery?: boolean;
  nextRunAt?: number;
  updatedBy?: string | null;
}

export interface BrowserTestRepo {
  insert(test: BrowserTest): Promise<void>;
  findById(workspaceId: string, id: string): Promise<BrowserTest | null>;
  list(workspaceId: string): Promise<BrowserTest[]>;
  listPage(
    workspaceId: string,
    cursor: Cursor | null | undefined,
    limit: number,
  ): Promise<BrowserTest[]>;
  update(id: string, changes: BrowserTestUpdate, at: number): Promise<void>;
  softDelete(id: string, at: number): Promise<void>;
  setNextRunAt(id: string, at: number): Promise<void>;
  claimDue(now: number, limit: number): Promise<ClaimedBrowserTest[]>;
  setChannels(testId: string, channelIds: string[]): Promise<void>;
  /** Links a channel to every live test of the workspace (idempotent). */
  addChannelToAll(workspaceId: string, channelId: string): Promise<void>;
  getChannelIds(testId: string): Promise<string[]>;
  getChannelIdsForTests(
    workspaceId: string,
    testIds: string[],
  ): Promise<Map<string, string[]>>;
}

export interface RunFinalize {
  status: RunStatus;
  finishedAt: number;
  durationMs: number;
  attemptCount: number;
  passedAfterRetry: boolean;
  billable: boolean;
  incidentId?: string | null;
}

export interface RunIncidentOrder {
  browserTestId: string;
  finishedAt: number;
  createdAt: number;
  runId: string;
}

export interface RunRepo {
  insert(run: TestRun): Promise<void>;
  insertWithAttempt(run: TestRun, attempt: TestAttempt): Promise<void>;
  findByIdForExecution(runId: string): Promise<TestRun | null>;
  findById(workspaceId: string, runId: string): Promise<TestRun | null>;
  listForTest(
    testId: string,
    cursor: Cursor | null | undefined,
    limit: number,
    statusFilter?: RunStatus,
  ): Promise<TestRun[]>;
  updateStatus(
    runId: string,
    status: RunStatus,
    startedAt?: number,
  ): Promise<void>;
  finalize(runId: string, changes: RunFinalize): Promise<void>;
  setAttemptCount(runId: string, attemptCount: number): Promise<void>;
  setUsageEventId(runId: string, usageEventId: string): Promise<void>;
  setIncidentId(runId: string, incidentId: string | null): Promise<void>;
  hasLaterIncidentResult(order: RunIncidentOrder): Promise<boolean>;
  incrementInfraAttempts(runId: string): Promise<number>;
  lastRunSummaryPerTest(
    workspaceId: string,
    testIds?: string[],
  ): Promise<Map<string, RunSummaryRow>>;
  /** Last `limit` runs per test (oldest first), including queued and running ones. */
  recentRunsPerTest(
    workspaceId: string,
    limit: number,
    testIds?: string[],
  ): Promise<Map<string, RunTick[]>>;
  scheduledOccurrenceExists(
    testId: string,
    scheduledFor: number,
  ): Promise<boolean>;
  activeRunExists(testId: string): Promise<boolean>;
  countRunning(workspaceId: string): Promise<number>;
  /** Atomically consumes one exact run capability; false is fail-closed. */
  consumeActionAuthorization(
    runId: string,
    action: IrreversibleActionRequest,
  ): Promise<boolean>;
}

export interface AttemptUpdate {
  status?: AttemptStatus;
  retryDelaySeconds?: number;
  queuedAt?: number;
  startedAt?: number | null;
  finishedAt?: number | null;
  durationMs?: number | null;
  summary?: string | null;
  expectedResult?: string | null;
  actualResult?: string | null;
  failureReason?: string | null;
  visitedUrlsJson?: string | null;
  consoleErrorsJson?: string | null;
  networkErrorsJson?: string | null;
  tokenUsage?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  modelName?: string | null;
  runnerVersion?: string | null;
  runnerKind?: RunnerKind | null;
  systemErrorCode?: string | null;
}

export interface AttemptRepo {
  insert(attempt: TestAttempt): Promise<void>;
  findById(id: string): Promise<TestAttempt | null>;
  claimQueued(
    id: string,
    claimedAt: number,
    runnerDeliveryId?: string,
    claimedByRunnerId?: string,
  ): Promise<boolean>;
  isRunnerDeliveryOwner(id: string, runnerDeliveryId: string): Promise<boolean>;
  markRunning(
    id: string,
    runId: string,
    attemptIndex: number,
    startedAt: number,
    usageEvent: UsageEvent,
  ): Promise<boolean>;
  findByRunAndIndex(
    runId: string,
    attemptIndex: number,
  ): Promise<TestAttempt | null>;
  listForRun(runId: string): Promise<TestAttempt[]>;
  listForRunWithLatest(runId: string): Promise<AttemptWithLatest[]>;
  update(id: string, fields: AttemptUpdate): Promise<void>;
  resetForInfraRetry(id: string, queuedAt: number): Promise<void>;
  listStale(before: number): Promise<TestAttempt[]>;
  listExternallyClaimable(
    queuedBefore: number,
    abandonedBefore: number,
    limit: number,
  ): Promise<TestAttempt[]>;
}

export interface StepRepo {
  insertMany(steps: RunStep[]): Promise<void>;
  listForAttempt(attemptId: string): Promise<RunStep[]>;
  deleteForAttempt(attemptId: string): Promise<void>;
}

export interface ArtifactRepo {
  insert(artifact: RunArtifact): Promise<void>;
  findById(id: string): Promise<RunArtifact | null>;
  findByIds(ids: string[]): Promise<RunArtifact[]>;
  listForAttempt(attemptId: string): Promise<RunArtifact[]>;
  listForRun(runId: string): Promise<RunArtifact[]>;
  findReportForRun(runId: string): Promise<RunArtifact | null>;
  listExpired(before: number, limit: number): Promise<RunArtifact[]>;
  deleteByIds(ids: string[]): Promise<void>;
}

export type { ArtifactType };
