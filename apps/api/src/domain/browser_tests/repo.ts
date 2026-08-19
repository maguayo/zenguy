import type { Cursor } from "../../shared/pagination";
import type {
  ArtifactType,
  AttemptStatus,
  BrowserTest,
  ClaimedBrowserTest,
  Device,
  RunArtifact,
  RunStatus,
  RunStep,
  RunSummaryRow,
  TestAttempt,
  TestRun,
} from "./types";

export interface BrowserTestUpdate {
  name?: string;
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
  update(id: string, changes: BrowserTestUpdate, at: number): Promise<void>;
  softDelete(id: string, at: number): Promise<void>;
  setNextRunAt(id: string, at: number): Promise<void>;
  claimDue(now: number, limit: number): Promise<ClaimedBrowserTest[]>;
  setChannels(testId: string, channelIds: string[]): Promise<void>;
  getChannelIds(testId: string): Promise<string[]>;
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

export interface RunRepo {
  insert(run: TestRun): Promise<void>;
  insertWithAttempt(run: TestRun, attempt: TestAttempt): Promise<void>;
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
  setUsageEventId(runId: string, usageEventId: string): Promise<void>;
  setIncidentId(runId: string, incidentId: string | null): Promise<void>;
  incrementInfraAttempts(runId: string): Promise<number>;
  lastRunSummaryPerTest(
    workspaceId: string,
  ): Promise<Map<string, RunSummaryRow>>;
  activeRunExists(testId: string): Promise<boolean>;
  countRunning(workspaceId: string): Promise<number>;
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
  modelName?: string | null;
  runnerVersion?: string | null;
  systemErrorCode?: string | null;
}

export interface AttemptRepo {
  insert(attempt: TestAttempt): Promise<void>;
  findById(id: string): Promise<TestAttempt | null>;
  findByRunAndIndex(
    runId: string,
    attemptIndex: number,
  ): Promise<TestAttempt | null>;
  listForRun(runId: string): Promise<TestAttempt[]>;
  update(id: string, fields: AttemptUpdate): Promise<void>;
  resetForInfraRetry(id: string, queuedAt: number): Promise<void>;
  listStale(before: number): Promise<TestAttempt[]>;
}

export interface StepRepo {
  insertMany(steps: RunStep[]): Promise<void>;
  listForAttempt(attemptId: string): Promise<RunStep[]>;
  deleteForAttempt(attemptId: string): Promise<void>;
}

export interface ArtifactRepo {
  insert(artifact: RunArtifact): Promise<void>;
  findById(id: string): Promise<RunArtifact | null>;
  listForAttempt(attemptId: string): Promise<RunArtifact[]>;
  listForRun(runId: string): Promise<RunArtifact[]>;
  findReportForRun(runId: string): Promise<RunArtifact | null>;
  listExpired(before: number, limit: number): Promise<RunArtifact[]>;
  deleteByIds(ids: string[]): Promise<void>;
}

export type { ArtifactType };
