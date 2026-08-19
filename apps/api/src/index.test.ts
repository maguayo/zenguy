import type { CheckMessage, NotifyMessage } from "./domain/queues";
import { ExecuteAttempt } from "./application/execution/execute_attempt";
import { AttemptLifecycle } from "./application/execution/attempt_lifecycle";
import { HandleCheckMessage } from "./application/uptime/handle_check_message";
import { HourlyMaintenance } from "./application/maintenance/hourly";
import { SweepDueMonitors } from "./application/maintenance/sweep_due_monitors";
import { SweepDueTests } from "./application/maintenance/sweep_due_tests";
import { PurgeExpired } from "./application/maintenance/purge_expired";
import { fakeBindings } from "./test/fakes/bindings";
import {
  buildAttemptConsumer,
  buildAttemptLifecycle,
  buildCheckConsumer,
  buildHourlyJob,
  buildRetentionJob,
  buildSchedulerJobs,
  processQueueBatch,
  processScheduledCron,
  type ScheduledJobs,
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
    expect(buildAttemptLifecycle(fakeBindings())).toBeInstanceOf(
      AttemptLifecycle,
    );
    expect(buildCheckConsumer(fakeBindings())).toBeInstanceOf(HandleCheckMessage);
    const scheduler = buildSchedulerJobs(fakeBindings());
    expect(scheduler.tests).toBeInstanceOf(SweepDueTests);
    expect(scheduler.monitors).toBeInstanceOf(SweepDueMonitors);
    expect(buildRetentionJob(fakeBindings())).toBeInstanceOf(PurgeExpired);
    expect(buildHourlyJob(fakeBindings())).toBeInstanceOf(HourlyMaintenance);
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
    const checkBody: CheckMessage = {
      kind: "check",
      monitorId: "mon_1",
      workspaceId: "ws_1",
      cycleId: "cyc_1",
      attemptIndex: 0,
    };
    const poisonCheck = new RecordingMessage("msg_check_bad", {
      kind: "check",
      cycleId: "cyc_bad",
    });
    const checkMessage = new RecordingMessage("msg_check", checkBody);
    const notifyMessage = new RecordingMessage("msg_notify", NOTIFY);
    const checkExecute = vi.fn(async () => undefined);
    const notifyExecute = vi.fn(async (_message, control: Pick<Message, "ack">) => {
      control.ack();
    });
    const configured = consumers({
      checks: { execute: checkExecute },
      notifications: { execute: notifyExecute },
    });

    const alert = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await processQueueBatch(
      batch("zenguy-checks", [poisonCheck, checkMessage]),
      configured,
      CONTEXT,
    );
    await processQueueBatch(
      batch("zenguy-notify", [notifyMessage]),
      configured,
      CONTEXT,
    );

    expect(checkExecute).toHaveBeenCalledWith(checkBody, CONTEXT);
    expect(poisonCheck.ackCount).toBe(1);
    expect(checkMessage.ackCount).toBe(1);
    expect(notifyExecute).toHaveBeenCalledWith(NOTIFY, notifyMessage);
    expect(notifyMessage.ackCount).toBe(1);
    expect(alert.mock.calls.join(" ")).toContain('"event":"bad_queue_message"');
    alert.mockRestore();
  });

  it("routes every staging queue and acknowledges every staging dead-letter queue", async () => {
    const attemptMessage = new RecordingMessage("msg_staging_run", {
      kind: "attempt",
      runId: "run_staging",
      attemptId: "att_staging",
      attemptIndex: 0,
    });
    const checkBody: CheckMessage = {
      kind: "check",
      monitorId: "mon_staging",
      workspaceId: "ws_staging",
      cycleId: "cyc_staging",
      attemptIndex: 0,
    };
    const checkMessage = new RecordingMessage("msg_staging_check", checkBody);
    const notifyMessage = new RecordingMessage("msg_staging_notify", NOTIFY);
    const attemptExecute = vi.fn(async () => undefined);
    const checkExecute = vi.fn(async () => undefined);
    const notifyExecute = vi.fn(async (_message, control: Pick<Message, "ack">) => {
      control.ack();
    });
    const configured = consumers({
      attempts: { execute: attemptExecute },
      checks: { execute: checkExecute },
      notifications: { execute: notifyExecute },
    });

    await processQueueBatch(
      batch("zenguy-staging-runs", [attemptMessage]),
      configured,
      CONTEXT,
    );
    await processQueueBatch(
      batch("zenguy-staging-checks", [checkMessage]),
      configured,
      CONTEXT,
    );
    await processQueueBatch(
      batch("zenguy-staging-notify", [notifyMessage]),
      configured,
      CONTEXT,
    );

    expect(attemptExecute).toHaveBeenCalledOnce();
    expect(checkExecute).toHaveBeenCalledWith(checkBody, CONTEXT);
    expect(notifyExecute).toHaveBeenCalledWith(NOTIFY, notifyMessage);
    expect(attemptMessage.ackCount).toBe(1);
    expect(checkMessage.ackCount).toBe(1);
    expect(notifyMessage.ackCount).toBe(1);

    const alert = vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const queueName of [
      "zenguy-staging-runs-dlq",
      "zenguy-staging-checks-dlq",
      "zenguy-staging-notify-dlq",
    ]) {
      const deadLetterMessage = new RecordingMessage(`msg_${queueName}`, {
        source: queueName,
      });
      await processQueueBatch(
        batch(queueName, [deadLetterMessage]),
        configured,
        CONTEXT,
      );
      expect(deadLetterMessage.ackCount).toBe(1);
      expect(deadLetterMessage.retryOptions).toEqual([]);
    }
    expect(alert).toHaveBeenCalledTimes(3);
    alert.mockRestore();
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

function scheduledJobs(): {
  jobs: ScheduledJobs;
  calls: Record<keyof ScheduledJobs, ReturnType<typeof vi.fn>>;
} {
  const calls = {
    tests: vi.fn(async () => undefined),
    monitors: vi.fn(async () => undefined),
    retention: vi.fn(async () => undefined),
    hourly: vi.fn(async () => undefined),
  };
  return {
    calls,
    jobs: {
      tests: { execute: calls.tests },
      monitors: { execute: calls.monitors },
      retention: { execute: calls.retention },
      hourly: { execute: calls.hourly },
    },
  };
}

describe("scheduled routing", () => {
  it("dispatches every configured cron to only its intended jobs", async () => {
    const scheduler = scheduledJobs();
    await processScheduledCron("*/5 * * * *", scheduler.jobs);
    expect(scheduler.calls.tests).toHaveBeenCalledOnce();
    expect(scheduler.calls.monitors).toHaveBeenCalledOnce();
    expect(scheduler.calls.retention).not.toHaveBeenCalled();
    expect(scheduler.calls.hourly).not.toHaveBeenCalled();

    const retention = scheduledJobs();
    await processScheduledCron("0 3 * * *", retention.jobs);
    expect(retention.calls.retention).toHaveBeenCalledOnce();
    expect(retention.calls.tests).not.toHaveBeenCalled();

    const hourly = scheduledJobs();
    await processScheduledCron("30 * * * *", hourly.jobs);
    expect(hourly.calls.hourly).toHaveBeenCalledOnce();
    expect(hourly.calls.monitors).not.toHaveBeenCalled();
  });

  it("turns cron failures and unknown schedules into platform alerts", async () => {
    const configured = scheduledJobs();
    configured.jobs.tests.execute = vi.fn(async () => {
      throw new Error("scheduler failed");
    });
    const alert = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      processScheduledCron("*/5 * * * *", configured.jobs),
    ).resolves.toBeUndefined();
    await processScheduledCron("1 2 3 4 5", configured.jobs);

    const logged = alert.mock.calls.join(" ");
    expect(logged).toContain('"event":"scheduled_job_failed"');
    expect(logged).toContain('"event":"unsupported_cron"');
    alert.mockRestore();
  });
});
