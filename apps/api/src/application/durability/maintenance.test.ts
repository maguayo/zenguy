import { FixedClock } from "../../shared/clock";
import { FakeDurableWorkflowRepo } from "../../test/fakes/durable";
import { FakeIds } from "../../test/fakes/ids";
import { createDurableJob, createOutboxEntry } from "./factory";
import { DurableWorkflowMaintenance } from "./maintenance";
import { PublishQueueOutbox } from "./publish_outbox";

const NOW = 1_800_000_000_000;
const OLD = NOW - 31 * 86_400_000;

class NoopQueue {
  async send(): Promise<QueueSendResponse> {
    return { metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } } };
  }
}

describe("DurableWorkflowMaintenance", () => {
  it("reconciles both job families and purges only state older than 30 days", async () => {
    const durable = new FakeDurableWorkflowRepo();
    const ids = new FakeIds();
    const oldOutbox = {
      ...createOutboxEntry({
        dedupeKey: "old:published",
        queueKind: "RUN" as const,
        payload: {},
        availableAt: OLD,
        now: OLD,
        ids,
      }),
      publishedAt: OLD,
    };
    const recentOutbox = {
      ...createOutboxEntry({
        dedupeKey: "recent:published",
        queueKind: "RUN" as const,
        payload: {},
        availableAt: NOW,
        now: NOW,
        ids,
      }),
      publishedAt: NOW - 1,
    };
    durable.outboxEntries.set(oldOutbox.id, oldOutbox);
    durable.outboxEntries.set(recentOutbox.id, recentOutbox);
    const oldQuarantinedOutbox = {
      ...createOutboxEntry({
        dedupeKey: "old:quarantined",
        queueKind: "RUN" as const,
        payload: {},
        availableAt: OLD,
        now: OLD,
        ids,
      }),
    };
    durable.outboxEntries.set(oldQuarantinedOutbox.id, oldQuarantinedOutbox);
    await durable.quarantineOutbox(oldQuarantinedOutbox.id, OLD, "poison");
    const oldJob = {
      ...createDurableJob({
        kind: "RUN_FINALIZATION" as const,
        aggregateKey: "run_old",
        payload: {},
        now: OLD,
        ids,
      }),
      status: "COMPLETED" as const,
      completedAt: OLD,
    };
    const recentJob = {
      ...createDurableJob({
        kind: "RUN_FINALIZATION" as const,
        aggregateKey: "run_recent",
        payload: {},
        now: NOW,
        ids,
      }),
      status: "COMPLETED" as const,
      completedAt: NOW - 1,
    };
    durable.jobs.set(oldJob.id, oldJob);
    durable.jobs.set(recentJob.id, recentJob);
    const oldQuarantinedJob = createDurableJob({
      kind: "RUN_FINALIZATION" as const,
      aggregateKey: "run_poison",
      payload: {},
      now: OLD,
      ids,
    });
    durable.jobs.set(oldQuarantinedJob.id, oldQuarantinedJob);
    durable.quarantinedJobsAt.set(oldQuarantinedJob.id, OLD);
    const attempts = { resumePendingJobs: vi.fn(async () => undefined) };
    const checks = { resumePendingJobs: vi.fn(async () => undefined) };
    const queue = new NoopQueue();
    const publisher = new PublishQueueOutbox(
      durable,
      { RUN: queue, CHECK: queue, NOTIFY: queue },
      new FixedClock(NOW),
    );
    const maintenance = new DurableWorkflowMaintenance(
      attempts,
      checks,
      publisher,
      durable,
      durable,
      new FixedClock(NOW),
    );

    await expect(maintenance.execute()).resolves.toEqual({
      published: 0,
      failed: 0,
      purgedOutbox: 1,
      purgedJobs: 1,
      purgedQuarantinedOutbox: 1,
      purgedQuarantinedJobs: 1,
    });
    expect(attempts.resumePendingJobs).toHaveBeenCalledOnce();
    expect(checks.resumePendingJobs).toHaveBeenCalledOnce();
    expect(durable.outboxEntries.has(oldOutbox.id)).toBe(false);
    expect(durable.outboxEntries.has(recentOutbox.id)).toBe(true);
    expect(durable.jobs.has(oldJob.id)).toBe(false);
    expect(durable.jobs.has(recentJob.id)).toBe(true);
    expect(durable.outboxEntries.has(oldQuarantinedOutbox.id)).toBe(false);
    expect(durable.jobs.has(oldQuarantinedJob.id)).toBe(false);
  });
});
