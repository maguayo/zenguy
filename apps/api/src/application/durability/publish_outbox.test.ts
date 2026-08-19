import type { AttemptMessage, CheckMessage, NotifyMessage } from "../../domain/queues";
import { FixedClock } from "../../shared/clock";
import { FakeIds } from "../../test/fakes/ids";
import { FakeDurableWorkflowRepo } from "../../test/fakes/durable";
import { createDurableJob, createOutboxEntry } from "./factory";
import { PublishQueueOutbox } from "./publish_outbox";

const NOW = 1_800_000_000_000;

class RecordingQueue<T> implements Pick<Queue<T>, "send"> {
  readonly calls: Array<{ body: T; delaySeconds: number }> = [];
  failures = 0;

  async send(body: T, options?: QueueSendOptions): Promise<QueueSendResponse> {
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error("queue unavailable");
    }
    this.calls.push({
      body: structuredClone(body),
      delaySeconds: options?.delaySeconds ?? 0,
    });
    return { metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } } };
  }
}

function queues() {
  return {
    RUN: new RecordingQueue<AttemptMessage>(),
    CHECK: new RecordingQueue<CheckMessage>(),
    NOTIFY: new RecordingQueue<NotifyMessage>(),
  };
}

describe("PublishQueueOutbox", () => {
  it("quarantines an invalid payload so it cannot monopolize the flush limit", async () => {
    const clock = new FixedClock(NOW);
    const durable = new FakeDurableWorkflowRepo();
    const producers = queues();
    const publisher = new PublishQueueOutbox(durable, producers, clock);
    const poison = createOutboxEntry({
      dedupeKey: "poison:run",
      queueKind: "RUN",
      payload: { kind: "attempt", runId: "missing-fields" },
      availableAt: NOW,
      now: NOW,
      ids: new FakeIds(),
    });
    durable.outboxEntries.set(poison.id, poison);
    const alert = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(publisher.flush(1)).resolves.toEqual({
      published: 0,
      failed: 0,
    });

    expect(durable.quarantinedOutbox.get(poison.id)).toContain("schema");
    expect(producers.RUN.calls).toEqual([]);
    await expect(publisher.flush(1)).resolves.toEqual({
      published: 0,
      failed: 0,
    });
    alert.mockRestore();
  });

  it("releases a failed claim and preserves the exact remaining delay", async () => {
    const clock = new FixedClock(NOW);
    const durable = new FakeDurableWorkflowRepo();
    const producers = queues();
    const publisher = new PublishQueueOutbox(durable, producers, clock);
    const entry = createOutboxEntry({
      dedupeKey: "attempt:att_delay:functional",
      queueKind: "RUN",
      payload: {
        kind: "attempt",
        runId: "run_delay",
        attemptId: "att_delay",
        attemptIndex: 2,
        executionGeneration: NOW + 60_000,
      } satisfies AttemptMessage,
      availableAt: NOW + 60_000,
      now: NOW,
      ids: new FakeIds(),
    });
    durable.outboxEntries.set(entry.id, entry);
    producers.RUN.failures = 1;
    const alert = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(publisher.publishById(entry.id)).rejects.toThrow(
      "queue unavailable",
    );
    expect(durable.outboxEntries.get(entry.id)?.publishingAt).toBeNull();
    clock.advance(15_000);
    await publisher.publishById(entry.id);

    expect(producers.RUN.calls).toEqual([
      {
        body: expect.objectContaining({ attemptId: "att_delay" }),
        delaySeconds: 45,
      },
    ]);
    expect(durable.outboxEntries.get(entry.id)?.publishedAt).toBe(NOW + 15_000);
    alert.mockRestore();
  });

  it("flushes due work without future or actively leased entries blocking it", async () => {
    const clock = new FixedClock(NOW);
    const durable = new FakeDurableWorkflowRepo();
    const producers = queues();
    const publisher = new PublishQueueOutbox(durable, producers, clock);
    const ids = new FakeIds();
    const future = createOutboxEntry({
      dedupeKey: "check:future:0",
      queueKind: "CHECK",
      payload: {
        kind: "check",
        monitorId: "mon_future",
        workspaceId: "ws_future",
        cycleId: "cyc_future",
        attemptIndex: 0,
      } satisfies CheckMessage,
      availableAt: NOW + 60_000,
      now: NOW - 2_000,
      ids,
    });
    const leased = {
      ...createOutboxEntry({
        dedupeKey: "check:leased:0",
        queueKind: "CHECK",
        payload: {
          kind: "check",
          monitorId: "mon_leased",
          workspaceId: "ws_leased",
          cycleId: "cyc_leased",
          attemptIndex: 0,
        } satisfies CheckMessage,
        availableAt: NOW - 1,
        now: NOW - 1_000,
        ids,
      }),
      publishingAt: NOW,
    };
    const due = createOutboxEntry({
      dedupeKey: "check:due:0",
      queueKind: "CHECK",
      payload: {
        kind: "check",
        monitorId: "mon_due",
        workspaceId: "ws_due",
        cycleId: "cyc_due",
        attemptIndex: 0,
      } satisfies CheckMessage,
      availableAt: NOW - 1,
      now: NOW,
      ids,
    });
    durable.outboxEntries.set(future.id, future);
    durable.outboxEntries.set(leased.id, leased);
    durable.outboxEntries.set(due.id, due);

    await expect(publisher.flush(1)).resolves.toEqual({
      published: 1,
      failed: 0,
    });

    expect(producers.CHECK.calls).toEqual([
      {
        body: expect.objectContaining({ monitorId: "mon_due" }),
        delaySeconds: 0,
      },
    ]);
    expect(durable.outboxEntries.get(future.id)?.publishedAt).toBeNull();
    expect(durable.outboxEntries.get(leased.id)?.publishedAt).toBeNull();
  });

  it("filters pending jobs by kind before applying the limit", async () => {
    const durable = new FakeDurableWorkflowRepo();
    const ids = new FakeIds();
    for (let index = 0; index < 101; index += 1) {
      const job = createDurableJob({
        kind: "CHECK_CONTINUATION",
        aggregateKey: `chk_${index}`,
        payload: {},
        now: index,
        ids,
      });
      durable.jobs.set(job.id, job);
    }
    const attempt = createDurableJob({
      kind: "ATTEMPT_CONTINUATION",
      aggregateKey: "att_after_checks:0",
      payload: {},
      now: 1_000,
      ids,
    });
    durable.jobs.set(attempt.id, attempt);

    await expect(
      durable.listPendingJobs(
        ["ATTEMPT_CONTINUATION", "RUN_FINALIZATION"],
        100,
      ),
    ).resolves.toEqual([attempt]);
  });
});
