import type {
  ChannelRepo,
  DeliveryRepo,
} from "../../domain/channels/repo";
import type { ChannelSender } from "../../domain/channels/notifier";
import type { NotifyMessage } from "../../domain/queues";
import type {
  NotificationChannel,
  NotificationDelivery,
} from "../../domain/channels/types";
import type { Clock } from "../../shared/clock";
import { decryptSecret } from "../../shared/crypto";
import { logEvent } from "../../shared/log";
import { truncate } from "../../shared/redact";
import type { IncidentEventWriter } from "./incident_event_writer";

export type NotificationQueueControl = Pick<
  Message<NotifyMessage>,
  "ack" | "retry"
>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "notification error";
}

function retryDelay(attemptCount: number): number {
  return Math.min(300, 30 * 2 ** Math.max(0, attemptCount - 1));
}

export class SendQueuedNotification {
  constructor(
    private readonly deliveries: DeliveryRepo,
    private readonly channels: ChannelRepo,
    private readonly sender: ChannelSender,
    private readonly incidentEvents: IncidentEventWriter,
    private readonly encryptionKey: Uint8Array,
    private readonly clock: Clock,
  ) {}

  async execute(
    input: NotifyMessage,
    queueMessage: NotificationQueueControl,
  ): Promise<void> {
    const delivery = await this.deliveries.findById(
      input.workspaceId,
      input.deliveryId,
    );
    if (delivery === null || delivery.status !== "PENDING") {
      queueMessage.ack();
      return;
    }
    const channel = await this.channels.findById(
      input.workspaceId,
      input.channelId,
    );
    if (
      channel === null ||
      !channel.enabled ||
      delivery.notificationChannelId !== input.channelId
    ) {
      await this.markRemoved(delivery, channel);
      queueMessage.ack();
      return;
    }

    const attemptCount = delivery.attemptCount + 1;
    let sent: { providerMessageId: string | null };
    try {
      const plaintext = await decryptSecret(
        channel.encryptedConfig,
        this.encryptionKey,
      );
      sent = await this.sender.send(
        { type: channel.type, config: JSON.parse(plaintext) },
        input.message,
      );
    } catch (error) {
      if (attemptCount < 3) {
        await this.deliveries.update(delivery.id, {
          status: "PENDING",
          attemptCount,
        });
        queueMessage.retry({ delaySeconds: retryDelay(attemptCount) });
        return;
      }
      const errorSanitized = truncate(errorMessage(error), 300);
      await this.deliveries.update(delivery.id, {
        status: "FAILED",
        errorSanitized,
        attemptCount,
      });
      await this.channels.setLastDeliveryStatus(channel.id, "FAILED");
      await this.writeIncidentEvent(
        delivery,
        channel,
        "NOTIFICATION_FAILED",
        "FAILED",
      );
      logEvent("notification_delivery_failed", {
        deliveryId: delivery.id,
        channelId: channel.id,
        attemptCount,
        error: errorSanitized,
      });
      queueMessage.ack();
      return;
    }
    const sentAt = this.clock.now();
    await this.deliveries.update(delivery.id, {
      status: "SENT",
      providerMessageId: sent.providerMessageId,
      errorSanitized: null,
      attemptCount,
      sentAt,
    });
    await this.channels.setLastDeliveryStatus(channel.id, "SENT");
    await this.channels.setVerified(channel.id, sentAt);
    await this.writeIncidentEvent(
      delivery,
      channel,
      "NOTIFICATION_SENT",
      "SENT",
    );
    queueMessage.ack();
  }

  private async markRemoved(
    delivery: NotificationDelivery,
    channel: NotificationChannel | null,
  ): Promise<void> {
    await this.deliveries.update(delivery.id, {
      status: "FAILED",
      errorSanitized: "channel removed",
      attemptCount: delivery.attemptCount,
    });
    if (channel !== null) {
      await this.channels.setLastDeliveryStatus(channel.id, "FAILED");
    }
    if (delivery.incidentId !== null) {
      await this.incidentEvents.write({
        workspaceId: delivery.workspaceId,
        incidentId: delivery.incidentId,
        type: "NOTIFICATION_FAILED",
        channelId: delivery.notificationChannelId,
        channelName: channel?.name ?? "Removed channel",
        deliveryId: delivery.id,
        status: "FAILED",
      });
    }
    logEvent("notification_delivery_failed", {
      deliveryId: delivery.id,
      channelId: delivery.notificationChannelId,
      attemptCount: delivery.attemptCount,
      error: "channel removed",
    });
  }

  private async writeIncidentEvent(
    delivery: NotificationDelivery,
    channel: NotificationChannel,
    type: "NOTIFICATION_SENT" | "NOTIFICATION_FAILED",
    status: "SENT" | "FAILED",
  ): Promise<void> {
    if (delivery.incidentId === null) return;
    await this.incidentEvents.write({
      workspaceId: delivery.workspaceId,
      incidentId: delivery.incidentId,
      type,
      channelId: channel.id,
      channelName: channel.name,
      deliveryId: delivery.id,
      status,
    });
  }
}
