import type {
  AttemptMessage,
  CheckMessage,
  NotifyMessage,
} from "../../domain/queues";
import { FixedClock } from "../../shared/clock";
import { FakeDurableWorkflowRepo } from "../../test/fakes/durable";
import { FakeIds } from "../../test/fakes/ids";
import { PublishQueueOutbox } from "./publish_outbox";
import { RedriveDeadLetter } from "./redrive_dead_letter";

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

function fixture() {
  const clock = new FixedClock(NOW);
  const durable = new FakeDurableWorkflowRepo();
  const queues = {
    RUN: new RecordingQueue<AttemptMessage>(),
    CHECK: new RecordingQueue<CheckMessage>(),
    NOTIFY: new RecordingQueue<NotifyMessage>(),
  };
  const publisher = new PublishQueueOutbox(durable, queues, clock);
  return {
    durable,
    queues,
    redriver: new RedriveDeadLetter(
      durable,
      publisher,
      clock,
      new FakeIds(),
    ),
  };
}

function message(id: string, body: unknown) {
  return { id, body, ack: vi.fn() };
}

describe("RedriveDeadLetter", () => {
  it("persists a valid DLQ message before publishing and acknowledging it", async () => {
    const value = fixture();
    const queued = message("msg_1", {
      kind: "attempt",
      runId: "run_1",
      attemptId: "att_1",
      attemptIndex: 0,
      executionGeneration: NOW,
    });

    await value.redriver.execute("zenguy-runs-dlq", queued);

    expect(queued.ack).toHaveBeenCalledOnce();
    expect(value.durable.outboxEntries.size).toBe(1);
    expect(value.queues.RUN.calls).toEqual([
      {
        body: expect.objectContaining({
          runId: "run_1",
          redriveCount: 1,
        }),
        delaySeconds: 30,
      },
    ]);
    expect([...value.durable.outboxEntries.values()][0]?.publishedAt).toBe(NOW);
  });

  it.each([
    {
      queue: "zenguy-local-runs-dlq",
      body: {
        kind: "attempt",
        runId: "run_local",
        attemptId: "att_local",
        attemptIndex: 0,
        executionGeneration: NOW,
      },
      kind: "RUN" as const,
    },
    {
      queue: "zenguy-local-checks-dlq",
      body: {
        kind: "check",
        monitorId: "mon_local",
        workspaceId: "ws_local",
        cycleId: "cyc_local",
        attemptIndex: 0,
      },
      kind: "CHECK" as const,
    },
    {
      queue: "zenguy-local-notify-dlq",
      body: {
        kind: "notify",
        deliveryId: "del_local",
        workspaceId: "ws_local",
        channelId: "ch_local",
        message: {
          eventType: "TEST",
          title: "Local",
          lines: ["Local"],
          link: "https://app.zenguy.test",
          speakText: "Local",
          shortText: "Local",
          color: "gray",
        },
      },
      kind: "NOTIFY" as const,
    },
  ])("redrives configured local queue $queue as $kind", async ({ queue, body, kind }) => {
    const value = fixture();
    const queued = message(`msg_${kind}`, body);

    await value.redriver.execute(queue, queued);

    expect(queued.ack).toHaveBeenCalledOnce();
    expect(value.queues[kind].calls).toHaveLength(1);
  });

  it("does not acknowledge an unsupported DLQ name", async () => {
    const value = fixture();
    const queued = message("msg_unknown", { kind: "unknown" });
    const alert = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      value.redriver.execute("zenguy-partner-runs-dlq", queued),
    ).rejects.toThrow("Unsupported dead-letter queue");

    expect(queued.ack).not.toHaveBeenCalled();
    expect(value.durable.outboxEntries.size).toBe(0);
    expect(alert.mock.calls.join(" ")).toContain('"event":"unsupported_dlq"');
    alert.mockRestore();
  });

  it("acknowledges after persistence when immediate publish fails", async () => {
    const value = fixture();
    value.queues.CHECK.failures = 1;
    const queued = message("msg_deferred", {
      kind: "check",
      monitorId: "mon_1",
      workspaceId: "ws_1",
      cycleId: "cyc_1",
      attemptIndex: 0,
    });
    const alert = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await value.redriver.execute("zenguy-checks-dlq", queued);

    const entry = [...value.durable.outboxEntries.values()][0];
    expect(queued.ack).toHaveBeenCalledOnce();
    expect(entry?.publishedAt).toBeNull();
    expect(value.durable.outboxFailures.get(entry?.id ?? "")).toBe(1);
    expect(alert.mock.calls.join(" ")).toContain(
      '"event":"dlq_redrive_publish_deferred"',
    );
    alert.mockRestore();
  });

  it("persists and quarantines poison without publishing it", async () => {
    const value = fixture();
    const queued = message("msg_poison", {
      kind: "attempt",
      runId: "run_missing_fields",
    });
    const alert = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await value.redriver.execute("zenguy-runs-dlq", queued);

    const entry = [...value.durable.outboxEntries.values()][0];
    expect(queued.ack).toHaveBeenCalledOnce();
    expect(value.durable.quarantinedOutbox.get(entry?.id ?? "")).toContain(
      "does not match",
    );
    expect(value.queues.RUN.calls).toEqual([]);
    expect(alert.mock.calls.join(" ")).toContain("invalid_payload");
    alert.mockRestore();
  });

  it("quarantines a message after the bounded redrive limit", async () => {
    const value = fixture();
    const queued = message("msg_exhausted", {
      kind: "check",
      monitorId: "mon_1",
      workspaceId: "ws_1",
      cycleId: "cyc_1",
      attemptIndex: 0,
      redriveCount: 5,
    });
    const alert = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await value.redriver.execute("zenguy-staging-checks-dlq", queued);

    const entry = [...value.durable.outboxEntries.values()][0];
    expect(queued.ack).toHaveBeenCalledOnce();
    expect(value.durable.quarantinedOutbox.get(entry?.id ?? "")).toContain(
      "exceeded 5",
    );
    expect(value.queues.CHECK.calls).toEqual([]);
    expect(alert.mock.calls.join(" ")).toContain("redrive_limit");
    alert.mockRestore();
  });

  it("deduplicates a retried DLQ delivery by queue and message id", async () => {
    const value = fixture();
    value.queues.RUN.failures = 1;
    const body = {
      kind: "attempt",
      runId: "run_1",
      attemptId: "att_1",
      attemptIndex: 0,
      executionGeneration: NOW,
    } as const;
    const alert = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await value.redriver.execute("zenguy-runs-dlq", message("msg_same", body));
    await value.redriver.execute("zenguy-runs-dlq", message("msg_same", body));

    expect(value.durable.outboxEntries.size).toBe(1);
    expect(value.queues.RUN.calls).toHaveLength(1);
    expect(value.queues.RUN.calls[0]?.body.redriveCount).toBe(1);
    alert.mockRestore();
  });
});
