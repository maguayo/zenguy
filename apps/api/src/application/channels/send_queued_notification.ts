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
import { isPaidChannelType } from "../../domain/alerts/types";
import type { Clock } from "../../shared/clock";
import { decryptSecret } from "../../shared/crypto";
import { logEvent } from "../../shared/log";
import { Redactor, truncate } from "../../shared/redact";
import type {
  ChargeOutcome,
  PaidDeliveryCharger,
} from "../alerts/charge_paid_delivery";
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

const DELIVERY_LEASE_MS = 5 * 60_000;

function configValues(value: unknown): string[] {
  if (typeof value === "string") return value.length === 0 ? [] : [value];
  if (Array.isArray(value)) return value.flatMap(configValues);
  if (value !== null && typeof value === "object") {
    return Object.values(value).flatMap(configValues);
  }
  return [];
}

function channelConfigRedactor(plaintext: string, config: unknown): Redactor {
  return new Redactor(
    [plaintext, ...configValues(config)].map((value, index) => ({
      key: `CHANNEL_CONFIG_${index + 1}`,
      value,
    })),
  );
}

export class SendQueuedNotification {
  constructor(
    private readonly deliveries: DeliveryRepo,
    private readonly channels: ChannelRepo,
    private readonly sender: ChannelSender,
    private readonly incidentEvents: IncidentEventWriter,
    private readonly encryptionKey: Uint8Array,
    private readonly clock: Clock,
    private readonly charger: PaidDeliveryCharger,
  ) {}

  async execute(
    input: NotifyMessage,
    queueMessage: NotificationQueueControl,
  ): Promise<void> {
    const found = await this.deliveries.findById(
      input.workspaceId,
      input.deliveryId,
    );
    if (found === null) {
      queueMessage.ack();
      return;
    }
    if (found.status !== "PENDING") {
      const channel = await this.channels.findById(
        input.workspaceId,
        found.notificationChannelId,
      );
      await this.reconcileTerminal(found, channel);
      queueMessage.ack();
      return;
    }
    const claimedAt = this.clock.now();
    const delivery = await this.deliveries.claimPending(
      input.workspaceId,
      input.deliveryId,
      claimedAt,
      claimedAt - DELIVERY_LEASE_MS,
    );
    if (delivery === null) {
      queueMessage.retry({ delaySeconds: 30 });
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
    const paid = isPaidChannelType(channel.type);
    let sent: { providerMessageId: string | null };
    let charge: ChargeOutcome | null = null;
    let redactor = new Redactor([]);
    try {
      const plaintext = await decryptSecret(
        channel.encryptedConfig,
        this.encryptionKey,
      );
      const parsedConfig = JSON.parse(plaintext) as unknown;
      redactor = channelConfigRedactor(plaintext, parsedConfig);
      if (paid) {
        // Charge before the provider call. The charge is idempotent per
        // delivery, so a Queue retry of this message never pays twice.
        charge = await this.charger.charge({
          workspaceId: input.workspaceId,
          deliveryId: delivery.id,
          channelType: channel.type,
          config: parsedConfig,
        });
        if (!charge.ok) {
          await this.skip(delivery, channel, attemptCount, charge.message);
          queueMessage.ack();
          return;
        }
      }
      sent = await this.sender.send(
        { type: channel.type, config: parsedConfig, workspaceId: input.workspaceId },
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
      const errorSanitized = truncate(
        redactor.redact(errorMessage(error)),
        300,
      );
      await this.deliveries.update(delivery.id, {
        status: "FAILED",
        errorSanitized,
        attemptCount,
      });
      if (paid) {
        await this.refundSafely(delivery, "provider delivery failed");
      }
      await this.reconcileTerminal(
        {
          ...delivery,
          status: "FAILED",
          errorSanitized,
          attemptCount,
        },
        channel,
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
    const cost =
      charge !== null && charge.ok
        ? {
            costCents: charge.costCents,
            destinationCountry: charge.destination.name,
          }
        : {};
    await this.deliveries.update(delivery.id, {
      status: "SENT",
      providerMessageId: sent.providerMessageId,
      errorSanitized: null,
      attemptCount,
      sentAt,
      ...cost,
    });
    await this.reconcileTerminal(
      {
        ...delivery,
        status: "SENT",
        providerMessageId: sent.providerMessageId,
        errorSanitized: null,
        attemptCount,
        sentAt,
        ...cost,
      },
      channel,
    );
    queueMessage.ack();
  }

  private async skip(
    delivery: NotificationDelivery,
    channel: NotificationChannel,
    attemptCount: number,
    reason: string,
  ): Promise<void> {
    await this.deliveries.update(delivery.id, {
      status: "FAILED",
      errorSanitized: reason,
      attemptCount,
    });
    await this.reconcileTerminal(
      { ...delivery, status: "FAILED", errorSanitized: reason, attemptCount },
      channel,
    );
    logEvent("notification_delivery_skipped", {
      deliveryId: delivery.id,
      channelId: channel.id,
      reason,
    });
  }

  private async refundSafely(
    delivery: NotificationDelivery,
    reason: string,
  ): Promise<void> {
    try {
      await this.charger.refund({
        workspaceId: delivery.workspaceId,
        deliveryId: delivery.id,
        reason,
      });
    } catch {
      logEvent("alert_credit_refund_failed", { deliveryId: delivery.id });
    }
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
    await this.reconcileTerminal(
      {
        ...delivery,
        status: "FAILED",
        errorSanitized: "channel removed",
      },
      channel,
    );
    logEvent("notification_delivery_failed", {
      deliveryId: delivery.id,
      channelId: delivery.notificationChannelId,
      attemptCount: delivery.attemptCount,
      error: "channel removed",
    });
  }

  /**
   * Provider delivery and local follow-up effects are intentionally separate:
   * a provider call cannot participate in our D1 transaction. Replaying this
   * method for an already-terminal delivery completes the local effects
   * without ever calling the provider twice.
   */
  private async reconcileTerminal(
    delivery: NotificationDelivery,
    channel: NotificationChannel | null,
  ): Promise<void> {
    if (delivery.status !== "SENT" && delivery.status !== "FAILED") return;
    if (channel !== null) {
      await this.channels.setLastDeliveryStatus(channel.id, delivery.status);
      if (delivery.status === "SENT") {
        await this.channels.setVerified(
          channel.id,
          delivery.sentAt ?? delivery.createdAt,
        );
      }
    }
    if (delivery.incidentId === null) return;
    await this.incidentEvents.write({
      workspaceId: delivery.workspaceId,
      incidentId: delivery.incidentId,
      type:
        delivery.status === "SENT"
          ? "NOTIFICATION_SENT"
          : "NOTIFICATION_FAILED",
      channelId: delivery.notificationChannelId,
      channelName: channel?.name ?? "Removed channel",
      deliveryId: delivery.id,
      status: delivery.status,
      ...(delivery.status === "FAILED" &&
      delivery.errorSanitized !== null &&
      delivery.errorSanitized.length > 0
        ? { detail: delivery.errorSanitized }
        : {}),
    });
  }
}
