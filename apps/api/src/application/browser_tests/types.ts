import type {
  BrowserTest,
  Device,
  RunSource,
  RunStatus,
  RunSummaryRow,
} from "../../domain/browser_tests/types";
import type { User } from "../../domain/users/types";

export interface RunSummaryOutput {
  id: string;
  status: RunStatus;
  source: RunSource;
  startedAt: number | null;
  finishedAt: number | null;
  durationMs: number | null;
  passedAfterRetry: boolean;
  createdAt: number;
}

export interface BrowserTestOutput {
  id: string;
  name: string;
  startUrl: string;
  instructions: string;
  device: Device;
  intervalHours: number;
  maxRetries: number;
  notifyOnRecovery: boolean;
  channelIds: string[];
  nextRunAt: number;
  createdBy: { userId: string; name: string } | null;
  createdAt: number;
  updatedAt: number;
  lastRun: RunSummaryOutput | null;
  openIncidentId: null;
}

function runSummary(summary: RunSummaryRow | null): RunSummaryOutput | null {
  if (summary === null) return null;
  return {
    id: summary.id,
    status: summary.status,
    source: summary.source,
    startedAt: summary.startedAt,
    finishedAt: summary.finishedAt,
    durationMs: summary.durationMs,
    passedAfterRetry: summary.passedAfterRetry,
    createdAt: summary.createdAt,
  };
}

export function browserTestOutput(
  test: BrowserTest,
  channelIds: string[],
  creator: User | null,
  lastRun: RunSummaryRow | null,
): BrowserTestOutput {
  return {
    id: test.id,
    name: test.name,
    startUrl: test.startUrl,
    instructions: test.instructions,
    device: test.device,
    intervalHours: test.intervalHours,
    maxRetries: test.maxRetries,
    notifyOnRecovery: test.notifyOnRecovery,
    channelIds: [...channelIds],
    nextRunAt: test.nextRunAt,
    createdBy:
      creator === null ? null : { userId: creator.id, name: creator.name },
    createdAt: test.createdAt,
    updatedAt: test.updatedAt,
    lastRun: runSummary(lastRun),
    openIncidentId: null,
  };
}
