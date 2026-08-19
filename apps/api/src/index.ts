import { buildApp } from "./app";
import {
  NoopIncidentEventWriter,
} from "./application/channels/incident_event_writer";
import {
  SendQueuedNotification,
  type NotificationQueueControl,
} from "./application/channels/send_queued_notification";
import {
  attemptMessageSchema,
  notifyMessageSchema,
  type AttemptMessage,
} from "./domain/queues";
import { D1ChannelRepo } from "./infrastructure/db/channel_repo";
import { D1DeliveryRepo } from "./infrastructure/db/delivery_repo";
import { buildEmailSender } from "./infrastructure/email";
import { buildChannelSender } from "./infrastructure/notify";
import { systemClock } from "./shared/clock";
import { loadConfig, type Bindings } from "./shared/config";
import { platformAlert } from "./shared/log";

type NotifyConsumer = Pick<SendQueuedNotification, "execute">;
export interface AttemptQueueConsumer {
  execute(message: AttemptMessage, context: ExecutionContext): Promise<void>;
}

export interface CheckQueueConsumer {
  execute(message: unknown, context: ExecutionContext): Promise<void>;
}

export interface QueueConsumers {
  attempts: AttemptQueueConsumer;
  checks: CheckQueueConsumer;
  notifications: NotifyConsumer;
}

function queueRetryDelay(attempts: number): number {
  return Math.min(300, 30 * 2 ** Math.max(0, attempts - 1));
}

export async function processNotifyBatch(
  batch: MessageBatch<unknown>,
  consumer: NotifyConsumer,
): Promise<void> {
  for (const queueMessage of batch.messages) {
    const parsed = notifyMessageSchema.safeParse(queueMessage.body);
    if (!parsed.success) {
      queueMessage.ack();
      platformAlert("bad_queue_message", {
        queue: batch.queue,
        messageId: queueMessage.id,
      });
      continue;
    }
    try {
      await consumer.execute(
        parsed.data,
        queueMessage as NotificationQueueControl,
      );
    } catch {
      platformAlert("queue_message_failed", {
        queue: batch.queue,
        messageId: queueMessage.id,
      });
      queueMessage.retry({
        delaySeconds: queueRetryDelay(queueMessage.attempts),
      });
    }
  }
}

function badQueueMessage(batch: MessageBatch<unknown>, message: Message): void {
  message.ack();
  platformAlert("bad_queue_message", {
    queue: batch.queue,
    messageId: message.id,
  });
}

function failedQueueMessage(
  batch: MessageBatch<unknown>,
  message: Message,
): void {
  platformAlert("queue_message_failed", {
    queue: batch.queue,
    messageId: message.id,
  });
  message.retry();
}

export async function processAttemptBatch(
  batch: MessageBatch<unknown>,
  consumer: AttemptQueueConsumer,
  context: ExecutionContext,
): Promise<void> {
  for (const queueMessage of batch.messages) {
    const parsed = attemptMessageSchema.safeParse(queueMessage.body);
    if (!parsed.success) {
      badQueueMessage(batch, queueMessage);
      continue;
    }
    try {
      await consumer.execute(parsed.data, context);
      queueMessage.ack();
    } catch {
      failedQueueMessage(batch, queueMessage);
    }
  }
}

export async function processCheckBatch(
  batch: MessageBatch<unknown>,
  consumer: CheckQueueConsumer,
  context: ExecutionContext,
): Promise<void> {
  // CheckMessage and its schema arrive with the uptime domain in BE-062.
  // Until then this is deliberately a typed-unknown routing seam.
  for (const queueMessage of batch.messages) {
    try {
      await consumer.execute(queueMessage.body, context);
      queueMessage.ack();
    } catch {
      failedQueueMessage(batch, queueMessage);
    }
  }
}

function queueBodyPreview(body: unknown): string {
  try {
    return JSON.stringify(body).slice(0, 200);
  } catch {
    return "<unserializable>";
  }
}

export function processDeadLetterBatch(batch: MessageBatch<unknown>): void {
  for (const queueMessage of batch.messages) {
    platformAlert("dlq_message", {
      queue: batch.queue,
      body: queueBodyPreview(queueMessage.body),
    });
    queueMessage.ack();
  }
}

export async function processQueueBatch(
  batch: MessageBatch<unknown>,
  consumers: QueueConsumers,
  context: ExecutionContext,
): Promise<void> {
  if (batch.queue.endsWith("-dlq")) {
    processDeadLetterBatch(batch);
    return;
  }
  switch (batch.queue) {
    case "zenguy-runs":
      await processAttemptBatch(batch, consumers.attempts, context);
      return;
    case "zenguy-checks":
      await processCheckBatch(batch, consumers.checks, context);
      return;
    case "zenguy-notify":
      await processNotifyBatch(batch, consumers.notifications);
      return;
    default:
      platformAlert("unsupported_queue", { queue: batch.queue });
      for (const message of batch.messages) message.retry();
  }
}

function notifyConsumer(env: Bindings): SendQueuedNotification {
  const config = loadConfig(env);
  const emailSender = buildEmailSender(config);
  return new SendQueuedNotification(
    new D1DeliveryRepo(env.DB),
    new D1ChannelRepo(env.DB),
    buildChannelSender(config, emailSender),
    new NoopIncidentEventWriter(),
    config.encryptionKey,
    systemClock,
  );
}

const pendingAttemptConsumer: AttemptQueueConsumer = {
  async execute() {
    // Replaced by the concrete browser attempt consumer in BE-057.
    throw new Error("attempt consumer not available");
  },
};

const pendingCheckConsumer: CheckQueueConsumer = {
  async execute() {
    // Replaced by the concrete uptime check consumer in BE-064.
    throw new Error("check consumer not available");
  },
};

export async function queue(
  batch: MessageBatch<unknown>,
  env: Bindings,
  context: ExecutionContext,
): Promise<void> {
  if (batch.queue.endsWith("-dlq")) {
    processDeadLetterBatch(batch);
    return;
  }
  switch (batch.queue) {
    case "zenguy-runs":
      await processAttemptBatch(batch, pendingAttemptConsumer, context);
      return;
    case "zenguy-checks":
      await processCheckBatch(batch, pendingCheckConsumer, context);
      return;
    case "zenguy-notify":
      await processNotifyBatch(batch, notifyConsumer(env));
      return;
    default:
      platformAlert("unsupported_queue", { queue: batch.queue });
      for (const message of batch.messages) message.retry();
  }
}

export default {
  fetch(request, env, context) {
    return buildApp(env).fetch(request, env, context);
  },
  queue,
} satisfies ExportedHandler<Bindings>;
