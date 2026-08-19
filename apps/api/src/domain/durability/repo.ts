import type {
  AttemptUpdate,
  RunFinalize,
} from "../browser_tests/repo";
import type {
  TestAttempt,
  TestRun,
} from "../browser_tests/types";
import type { NotificationDelivery } from "../channels/types";
import type { UptimeCheck } from "../uptime/types";
import type {
  DurableJob,
  DurableJobKind,
  QueueOutboxEntry,
} from "./types";

export interface OutboxRepo {
  claimById(
    id: string,
    claimedAt: number,
    staleBefore: number,
  ): Promise<QueueOutboxEntry | null>;
  listPending(
    limit: number,
    availableBefore: number,
    staleBefore: number,
  ): Promise<QueueOutboxEntry[]>;
  markPublished(id: string, publishedAt: number): Promise<void>;
  releaseClaim(id: string, at: number): Promise<void>;
  insertOutbox(entry: QueueOutboxEntry): Promise<QueueOutboxEntry>;
  quarantineOutbox(id: string, at: number, reason: string): Promise<void>;
  recordOutboxFailure(
    id: string,
    at: number,
    reason: string,
  ): Promise<"retry" | "quarantined">;
  purgePublished(before: number, limit: number): Promise<number>;
}

export interface DurableWorkflowRepo {
  insertRunWithAttempt(
    run: TestRun,
    attempt: TestAttempt,
    outbox: QueueOutboxEntry,
  ): Promise<void>;
  recordAttemptCompletion(input: {
    attemptId: string;
    fields: AttemptUpdate;
    job: DurableJob;
  }): Promise<DurableJob>;
  findJob(
    kind: DurableJobKind,
    aggregateKey: string,
  ): Promise<DurableJob | null>;
  listPendingJobs(
    kinds: DurableJobKind[],
    limit: number,
  ): Promise<DurableJob[]>;
  scheduleFunctionalRetry(input: {
    jobId: string;
    runId: string;
    nextAttempt: TestAttempt;
    outbox: QueueOutboxEntry;
    at: number;
  }): Promise<void>;
  scheduleInfrastructureRetry(input: {
    jobId: string;
    runId: string;
    attemptId: string;
    attemptCount: number;
    queuedAt: number;
    artifactIds: string[];
    outbox: QueueOutboxEntry;
    at: number;
  }): Promise<void>;
  finalizeRun(input: {
    jobId: string;
    runId: string;
    changes: RunFinalize;
    finalizationJob: DurableJob;
    at: number;
  }): Promise<void>;
  insertDeliveryWithOutbox(input: {
    delivery: NotificationDelivery;
    dedupeKey: string;
    outbox: QueueOutboxEntry;
  }): Promise<{ deliveryId: string; outboxId: string; inserted: boolean }>;
  claimCheckExecution(input: {
    cycleId: string;
    attemptIndex: number;
    claimToken: string;
    claimedAt: number;
    staleBefore: number;
  }): Promise<"claimed" | "busy" | "completed">;
  releaseCheckExecution(input: {
    cycleId: string;
    attemptIndex: number;
    claimToken: string;
  }): Promise<void>;
  insertCheckWithJob(
    check: UptimeCheck,
    job: DurableJob,
    claimToken: string,
  ): Promise<"inserted" | "duplicate">;
  openMonitorCycleWithOutbox(input: {
    monitorId: string;
    cycleId: string;
    at: number;
    outbox: QueueOutboxEntry;
  }): Promise<boolean>;
  scheduleCheckRetry(input: {
    jobId: string;
    outbox: QueueOutboxEntry;
    at: number;
  }): Promise<void>;
  completeJob(jobId: string, at: number): Promise<void>;
  purgeCompleted(before: number, limit: number): Promise<number>;
}
