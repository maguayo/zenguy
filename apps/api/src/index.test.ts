import type { NotifyMessage } from "./domain/queues";
import { ExecuteAttempt } from "./application/execution/execute_attempt";
import { fakeBindings } from "./test/fakes/bindings";
import {
  buildAttemptConsumer,
  processQueueBatch,
  type QueueConsumers,
} from "./index";

class RecordingMessage<T> implements Message<T> {
  readonly timestamp = new Date(0);
  readonly retryOptions: QueueRetryOptions[] = [];
  ackCount = 0;

  constructor(
    readonly id: string,
    readonly body: T,
    readonly attempts = 1,
  ) {}

  retry(options: QueueRetryOptions = {}): void {
    this.retryOptions.push(options);
  }

  ack(): void {
    this.ackCount += 1;
  }
}

function batch(
  queue: string,
  messages: Message<unknown>[],
): MessageBatch<unknown> {
  return {
    queue,
    messages,
    metadata: {
      metrics: { backlogCount: messages.length, backlogBytes: 0 },
    },
    retryAll: () => undefined,
    ackAll: () => undefined,
  };
}

const CONTEXT = {} as ExecutionContext;
const NOTIFY: NotifyMessage = {
  kind: "notify",
  deliveryId: "del_1",
  workspaceId: "ws_1",
  channelId: "ch_1",
  message: {
    eventType: "FAILURE",
    title: "Failure",
    lines: ["Failed"],
    link: "https://app.zenguy.test/w/ws_1/incidents/inc_1",
    speakText: "Failure",
    shortText: "Failure",
    color: "red",
  },
};

function consumers(overrides: Partial<QueueConsumers> = {}): QueueConsumers {
  return {
    attempts: { execute: vi.fn(async () => undefined) },
    checks: { execute: vi.fn(async () => undefined) },
    notifications: {
      execute: vi.fn(async (_message, control) => control.ack()),
    },
    ...overrides,
  };
}

describe("queue routing", () => {
  it("builds the concrete browser attempt consumer for the runs queue", () => {
    expect(buildAttemptConsumer(fakeBindings())).toBeInstanceOf(ExecuteAttempt);
  });

  it("parses attempt messages, acknowledges poison, and isolates handler failures", async () => {
    const poison = new RecordingMessage("msg_bad", { kind: "attempt" });
    const failed = new RecordingMessage("msg_failed", {
      kind: "attempt",
      runId: "run_failed",
      attemptId: "att_failed",
      attemptIndex: 0,
    });
    const valid = new RecordingMessage("msg_valid", {
      kind: "attempt",
      runId: "run_valid",
      attemptId: "att_valid",
      attemptIndex: 1,
    });
    const execute = vi.fn(async (message: { runId: string }) => {
      if (message.runId === "run_failed") throw new Error("boom");
    });
    const alert = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await processQueueBatch(
      batch("zenguy-runs", [poison, failed, valid]),
      consumers({ attempts: { execute } }),
      CONTEXT,
    );

    expect(execute).toHaveBeenCalledTimes(2);
    expect(poison.ackCount).toBe(1);
    expect(failed.retryOptions).toEqual([{}]);
    expect(valid.ackCount).toBe(1);
    expect(alert.mock.calls.join(" ")).toContain('"event":"bad_queue_message"');
    expect(alert.mock.calls.join(" ")).toContain(
      '"event":"queue_message_failed"',
    );
    alert.mockRestore();
  });

  it("routes check and notification batches to their respective handlers", async () => {
    const checkMessage = new RecordingMessage("msg_check", { cycleId: "cyc_1" });
    const notifyMessage = new RecordingMessage("msg_notify", NOTIFY);
    const checkExecute = vi.fn(async () => undefined);
    const notifyExecute = vi.fn(async (_message, control: Pick<Message, "ack">) => {
      control.ack();
    });
    const configured = consumers({
      checks: { execute: checkExecute },
      notifications: { execute: notifyExecute },
    });

    await processQueueBatch(
      batch("zenguy-checks", [checkMessage]),
      configured,
      CONTEXT,
    );
    await processQueueBatch(
      batch("zenguy-notify", [notifyMessage]),
      configured,
      CONTEXT,
    );

    expect(checkExecute).toHaveBeenCalledWith(checkMessage.body, CONTEXT);
    expect(checkMessage.ackCount).toBe(1);
    expect(notifyExecute).toHaveBeenCalledWith(NOTIFY, notifyMessage);
    expect(notifyMessage.ackCount).toBe(1);
  });

  it("alerts and acknowledges every dead-letter message with a bounded body", async () => {
    const message = new RecordingMessage("msg_dlq", { value: "x".repeat(400) });
    const alert = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await processQueueBatch(
      batch("zenguy-runs-dlq", [message]),
      consumers(),
      CONTEXT,
    );

    expect(message.ackCount).toBe(1);
    expect(message.retryOptions).toEqual([]);
    const logged = alert.mock.calls.join(" ");
    expect(logged).toContain('"event":"dlq_message"');
    expect(logged).toContain('"queue":"zenguy-runs-dlq"');
    const parsed = JSON.parse(String(alert.mock.calls[0]?.[0])) as {
      body: string;
    };
    expect(parsed.body.length).toBe(200);
    alert.mockRestore();
  });
});
