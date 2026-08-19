import { buildApp } from "./app";
import {
  NoopIncidentEventWriter,
} from "./application/channels/incident_event_writer";
import {
  SendQueuedNotification,
  type NotificationQueueControl,
} from "./application/channels/send_queued_notification";
import { notifyMessageSchema } from "./domain/queues";
import { D1ChannelRepo } from "./infrastructure/db/channel_repo";
import { D1DeliveryRepo } from "./infrastructure/db/delivery_repo";
import { buildEmailSender } from "./infrastructure/email";
import { buildChannelSender } from "./infrastructure/notify";
import { systemClock } from "./shared/clock";
import { loadConfig, type Bindings } from "./shared/config";
import { platformAlert } from "./shared/log";

type NotifyConsumer = Pick<SendQueuedNotification, "execute">;

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

export default {
  fetch(request, env, context) {
    return buildApp(env).fetch(request, env, context);
  },
  async queue(batch, env) {
    switch (batch.queue) {
      case "zenguy-notify":
        await processNotifyBatch(batch, notifyConsumer(env));
        return;
      default:
        platformAlert("unsupported_queue", { queue: batch.queue });
        for (const message of batch.messages) message.retry();
    }
  },
} satisfies ExportedHandler<Bindings>;
