import type {
  ArtifactRepo,
  AttemptRepo,
  RunRepo,
  StepRepo,
} from "../../domain/browser_tests/repo";
import type { NotificationDelivery } from "../../domain/channels/types";
import type { DeliveryRepo } from "../../domain/channels/repo";
import type {
  DurableWorkflowRepo,
  OutboxRepo,
} from "../../domain/durability/repo";
import type {
  DurableJob,
  DurableJobKind,
  QueueOutboxEntry,
} from "../../domain/durability/types";
import type { CheckRepo, MonitorRepo } from "../../domain/uptime/repo";

function copy<T>(value: T): T {
  return structuredClone(value);
}

export class FakeDurableWorkflowRepo
  implements DurableWorkflowRepo, OutboxRepo
{
  readonly jobs = new Map<string, DurableJob>();
  readonly outboxEntries = new Map<string, QueueOutboxEntry>();
  readonly quarantinedOutbox = new Map<string, string>();
  readonly quarantinedOutboxAt = new Map<string, number>();
  readonly quarantinedJobsAt = new Map<string, number>();
  readonly outboxFailures = new Map<string, number>();
  readonly deliveryDedupe = new Map<
    string,
    { deliveryId: string; outboxId: string }
  >();
  readonly checkClaims = new Map<
    string,
    {
      claimToken: string;
      claimedAt: number;
      completedAt: number | null;
      generation: number;
    }
  >();

  constructor(
    private readonly dependencies: {
      runs?: RunRepo;
      attempts?: AttemptRepo;
      steps?: StepRepo;
      artifacts?: ArtifactRepo;
      deliveries?: DeliveryRepo;
      checks?: CheckRepo;
      monitors?: MonitorRepo;
    } = {},
  ) {}

  async insertRunWithAttempt(run: Parameters<RunRepo["insert"]>[0], attempt: Parameters<AttemptRepo["insert"]>[0], outbox: QueueOutboxEntry): Promise<void> {
    if (this.dependencies.runs === undefined || this.dependencies.attempts === undefined) {
      throw new Error("run dependencies missing");
    }
    await this.dependencies.runs.insert(run);
    await this.dependencies.attempts.insert(attempt);
    this.outboxEntries.set(outbox.id, copy(outbox));
  }

  async recordAttemptCompletion(input: Parameters<DurableWorkflowRepo["recordAttemptCompletion"]>[0]): Promise<DurableJob> {
    const existing = await this.findJob(input.job.kind, input.job.aggregateKey);
    if (existing !== null) return existing;
    if (this.dependencies.attempts === undefined) throw new Error("attempts missing");
    const attempt = await this.dependencies.attempts.findById(input.attemptId);
    if (attempt === null || attempt.finishedAt !== null) {
      throw new Error("Attempt completion did not create a continuation");
    }
    await this.dependencies.attempts.update(input.attemptId, input.fields);
    this.jobs.set(input.job.id, copy(input.job));
    return copy(input.job);
  }

  async findJob(kind: DurableJobKind, aggregateKey: string): Promise<DurableJob | null> {
    const job = [...this.jobs.values()].find(
      (candidate) => candidate.kind === kind && candidate.aggregateKey === aggregateKey,
    );
    return job === undefined ? null : copy(job);
  }

  async listPendingJobs(kinds: DurableJobKind[], limit: number): Promise<DurableJob[]> {
    return [...this.jobs.values()]
      .filter((job) => job.status === "PENDING" && kinds.includes(job.kind))
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
      .slice(0, limit)
      .map(copy);
  }

  async scheduleFunctionalRetry(input: Parameters<DurableWorkflowRepo["scheduleFunctionalRetry"]>[0]): Promise<void> {
    if (!this.pending(input.jobId)) return;
    if (this.dependencies.attempts === undefined || this.dependencies.runs === undefined) throw new Error("run dependencies missing");
    if ((await this.dependencies.attempts.findByRunAndIndex(input.runId, input.nextAttempt.attemptIndex)) === null) {
      await this.dependencies.attempts.insert(input.nextAttempt);
    }
    const count = (await this.dependencies.attempts.listForRun(input.runId)).length;
    await this.dependencies.runs.setAttemptCount(input.runId, count);
    this.outboxEntries.set(input.outbox.id, copy(input.outbox));
    await this.completeJob(input.jobId, input.at);
  }

  async scheduleInfrastructureRetry(input: Parameters<DurableWorkflowRepo["scheduleInfrastructureRetry"]>[0]): Promise<void> {
    if (!this.pending(input.jobId)) return;
    const { runs, attempts, steps, artifacts } = this.dependencies;
    if (runs === undefined || attempts === undefined || steps === undefined || artifacts === undefined) throw new Error("run dependencies missing");
    await steps.deleteForAttempt(input.attemptId);
    await artifacts.deleteByIds(input.artifactIds);
    await runs.incrementInfraAttempts(input.runId);
    await runs.setAttemptCount(input.runId, input.attemptCount);
    await attempts.resetForInfraRetry(input.attemptId, input.queuedAt);
    this.outboxEntries.set(input.outbox.id, copy(input.outbox));
    await this.completeJob(input.jobId, input.at);
  }

  async finalizeRun(input: Parameters<DurableWorkflowRepo["finalizeRun"]>[0]): Promise<void> {
    if (!this.pending(input.jobId)) return;
    if (this.dependencies.runs === undefined) throw new Error("runs missing");
    await this.dependencies.runs.finalize(input.runId, input.changes);
    const existing = await this.findJob(input.finalizationJob.kind, input.finalizationJob.aggregateKey);
    if (existing === null) this.jobs.set(input.finalizationJob.id, copy(input.finalizationJob));
    await this.completeJob(input.jobId, input.at);
  }

  async insertDeliveryWithOutbox(input: Parameters<DurableWorkflowRepo["insertDeliveryWithOutbox"]>[0]): Promise<{ deliveryId: string; outboxId: string; inserted: boolean }> {
    const existing = this.deliveryDedupe.get(input.dedupeKey);
    if (existing !== undefined) return { ...existing, inserted: false };
    if (this.dependencies.deliveries === undefined) throw new Error("deliveries missing");
    await this.dependencies.deliveries.insert(input.delivery);
    this.outboxEntries.set(input.outbox.id, copy(input.outbox));
    const value = { deliveryId: input.delivery.id, outboxId: input.outbox.id };
    this.deliveryDedupe.set(input.dedupeKey, value);
    return { ...value, inserted: true };
  }

  async claimCheckExecution(input: Parameters<DurableWorkflowRepo["claimCheckExecution"]>[0]): Promise<"claimed" | "reclaimed" | "busy" | "completed"> {
    const key = `${input.cycleId}:${input.attemptIndex}`;
    const existing = this.checkClaims.get(key);
    if (existing?.completedAt !== null && existing !== undefined) return "completed";
    if (existing !== undefined && existing.claimedAt > input.staleBefore) return "busy";
    this.checkClaims.set(key, {
      claimToken: input.claimToken,
      claimedAt: input.claimedAt,
      completedAt: null,
      generation: (existing?.generation ?? 0) + 1,
    });
    return existing === undefined ? "claimed" : "reclaimed";
  }

  async releaseCheckExecution(input: Parameters<DurableWorkflowRepo["releaseCheckExecution"]>[0]): Promise<void> {
    const key = `${input.cycleId}:${input.attemptIndex}`;
    const existing = this.checkClaims.get(key);
    if (existing?.completedAt === null && existing.claimToken === input.claimToken) {
      this.checkClaims.delete(key);
    }
  }

  async insertCheckWithJob(check: Parameters<DurableWorkflowRepo["insertCheckWithJob"]>[0], job: DurableJob, claimToken: string): Promise<"inserted" | "duplicate"> {
    if (this.dependencies.checks === undefined) throw new Error("checks missing");
    const key = `${check.cycleId}:${check.attemptIndex}`;
    const claim = this.checkClaims.get(key);
    if (claim === undefined || claim.claimToken !== claimToken || claim.completedAt !== null) return "duplicate";
    const result = await this.dependencies.checks.insertIfAbsent(check);
    if (result === "inserted") {
      this.jobs.set(job.id, copy(job));
      this.checkClaims.set(key, { ...claim, completedAt: check.checkedAt });
    }
    return result;
  }

  async openMonitorCycleWithOutbox(input: Parameters<DurableWorkflowRepo["openMonitorCycleWithOutbox"]>[0]): Promise<boolean> {
    if (this.dependencies.monitors === undefined) throw new Error("monitors missing");
    const opened = await this.dependencies.monitors.openCycle(input.monitorId, input.cycleId, input.at);
    if (opened) this.outboxEntries.set(input.outbox.id, copy(input.outbox));
    return opened;
  }

  async scheduleCheckRetry(input: Parameters<DurableWorkflowRepo["scheduleCheckRetry"]>[0]): Promise<void> {
    if (!this.pending(input.jobId)) return;
    this.outboxEntries.set(input.outbox.id, copy(input.outbox));
    await this.completeJob(input.jobId, input.at);
  }

  async completeJob(jobId: string, at: number): Promise<void> {
    const job = this.jobs.get(jobId);
    if (job !== undefined && job.status === "PENDING") {
      this.jobs.set(jobId, { ...job, status: "COMPLETED", updatedAt: at, completedAt: at });
    }
  }

  async claimById(id: string, claimedAt: number, staleBefore: number): Promise<QueueOutboxEntry | null> {
    const entry = this.outboxEntries.get(id);
    if (entry === undefined || this.quarantinedOutbox.has(id) || entry.publishedAt !== null || (entry.publishingAt !== null && entry.publishingAt > staleBefore)) return null;
    const claimed = { ...entry, publishingAt: claimedAt, updatedAt: claimedAt };
    this.outboxEntries.set(id, claimed);
    return copy(claimed);
  }

  async listPending(limit: number, availableBefore: number, staleBefore: number): Promise<QueueOutboxEntry[]> {
    return [...this.outboxEntries.values()]
      .filter((entry) => !this.quarantinedOutbox.has(entry.id) && entry.publishedAt === null && entry.availableAt <= availableBefore && (entry.publishingAt === null || entry.publishingAt <= staleBefore))
      .sort((left, right) => left.availableAt - right.availableAt || left.createdAt - right.createdAt || left.id.localeCompare(right.id))
      .slice(0, limit)
      .map(copy);
  }

  async markPublished(id: string, publishedAt: number): Promise<void> {
    const entry = this.outboxEntries.get(id);
    if (entry !== undefined && entry.publishedAt === null) this.outboxEntries.set(id, { ...entry, publishingAt: null, publishedAt, updatedAt: publishedAt });
  }

  async releaseClaim(id: string, at: number): Promise<void> {
    const entry = this.outboxEntries.get(id);
    if (entry !== undefined && entry.publishedAt === null) this.outboxEntries.set(id, { ...entry, publishingAt: null, updatedAt: at });
  }

  async insertOutbox(entry: QueueOutboxEntry): Promise<QueueOutboxEntry> {
    const existing = [...this.outboxEntries.values()].find(
      (candidate) => candidate.dedupeKey === entry.dedupeKey,
    );
    if (existing !== undefined) return copy(existing);
    this.outboxEntries.set(entry.id, copy(entry));
    return copy(entry);
  }

  async quarantineOutbox(id: string, at: number, reason: string): Promise<void> {
    if (this.outboxEntries.has(id)) {
      this.quarantinedOutbox.set(id, reason);
      this.quarantinedOutboxAt.set(id, at);
    }
  }

  async recordOutboxFailure(
    id: string,
    at: number,
    reason: string,
  ): Promise<"retry" | "quarantined"> {
    const count = (this.outboxFailures.get(id) ?? 0) + 1;
    this.outboxFailures.set(id, count);
    const entry = this.outboxEntries.get(id);
    if (entry !== undefined) {
      this.outboxEntries.set(id, {
        ...entry,
        publishingAt: null,
        availableAt:
          count === 1
            ? entry.availableAt
            : Math.max(
                entry.availableAt,
                at + Math.min(300_000, 30_000 * 2 ** (count - 2)),
              ),
        updatedAt: at,
      });
    }
    if (count < 8) return "retry";
    this.quarantinedOutbox.set(id, reason);
    this.quarantinedOutboxAt.set(id, at);
    return "quarantined";
  }

  async purgePublished(before: number, limit: number): Promise<number> {
    const ids = [...this.outboxEntries.values()].filter((entry) => entry.publishedAt !== null && entry.publishedAt < before).sort((left, right) => (left.publishedAt ?? 0) - (right.publishedAt ?? 0) || left.id.localeCompare(right.id)).slice(0, limit).map((entry) => entry.id);
    ids.forEach((id) => this.outboxEntries.delete(id));
    return ids.length;
  }

  async purgeQuarantinedOutbox(before: number, limit: number): Promise<number> {
    const ids = [...this.quarantinedOutboxAt.entries()]
      .filter(([, at]) => at < before)
      .sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]))
      .slice(0, limit)
      .map(([id]) => id);
    for (const id of ids) {
      this.outboxEntries.delete(id);
      this.quarantinedOutbox.delete(id);
      this.quarantinedOutboxAt.delete(id);
    }
    return ids.length;
  }

  async purgeCompleted(before: number, limit: number): Promise<number> {
    const ids = [...this.jobs.values()].filter((job) => job.status === "COMPLETED" && job.completedAt !== null && job.completedAt < before).sort((left, right) => (left.completedAt ?? 0) - (right.completedAt ?? 0) || left.id.localeCompare(right.id)).slice(0, limit).map((job) => job.id);
    ids.forEach((id) => this.jobs.delete(id));
    return ids.length;
  }

  async purgeQuarantinedJobs(before: number, limit: number): Promise<number> {
    const ids = [...this.quarantinedJobsAt.entries()]
      .filter(([, at]) => at < before)
      .sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]))
      .slice(0, limit)
      .map(([id]) => id);
    for (const id of ids) {
      this.jobs.delete(id);
      this.quarantinedJobsAt.delete(id);
    }
    return ids.length;
  }

  private pending(jobId: string): boolean {
    return this.jobs.get(jobId)?.status === "PENDING";
  }
}

export type { NotificationDelivery };
