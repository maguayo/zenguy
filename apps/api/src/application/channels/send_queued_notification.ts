import { ACTIVITY_EVENTS } from "../../domain/activity/catalog";
import type {
  ChannelRepo,
  DeliveryRepo,
} from "../../domain/channels/repo";
import {
  NotificationProviderError,
  type ChannelSender,
} from "../../domain/channels/notifier";
import type { NotifyMessage } from "../../domain/queues";
import type {
  NotificationChannel,
  NotificationDelivery,
} from "../../domain/channels/types";
import { hasRecipientConsent } from "../../domain/channels/types";
import { isPaidChannelType } from "../../domain/alerts/types";
import type { Clock } from "../../shared/clock";
import { decryptSecret } from "../../shared/crypto";
import type { EncryptionKeyring } from "../../shared/crypto";
import { logEvent } from "../../shared/log";
import { Redactor, truncate } from "../../shared/redact";
import type { TrackEvent } from "../activity/track_event";
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
const AMBIGUOUS_DELIVERY_ERROR =
  "Provider outcome is ambiguous; automatic retry was stopped";

export interface WorkspaceOperational {
  isOperational(workspaceId: string): Promise<boolean>;
}

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
    private readonly encryptionKeys: EncryptionKeyring,
    private readonly clock: Clock,
    private readonly charger: PaidDeliveryCharger,
    private readonly workspaceOperational?: WorkspaceOperational,
    private readonly track?: Pick<TrackEvent, "execute">,
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
    if (
      found.status !== "PENDING" ||
      found.dispatchState === "AMBIGUOUS"
    ) {
      const channel = await this.channels.findById(
        input.workspaceId,
        found.notificationChannelId,
      );
      await this.reconcileTerminal(found, channel);
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
      found.notificationChannelId !== input.channelId
    ) {
      await this.markRemoved(found, channel);
      queueMessage.ack();
      return;
    }
    if (
      this.workspaceOperational !== undefined &&
      !(await this.workspaceOperational.isOperational(input.workspaceId))
    ) {
      queueMessage.ack();
      return;
    }
    const claimedAt = this.clock.now();
    const dispatchToken = crypto.randomUUID();
    const claim = await this.deliveries.beginDispatch(
      input.workspaceId,
      input.deliveryId,
      dispatchToken,
      claimedAt,
      claimedAt - DELIVERY_LEASE_MS,
    );
    if (claim === null) {
      const ambiguous = await this.deliveries.markStaleDispatchAmbiguous(
        input.workspaceId,
        input.deliveryId,
        claimedAt - DELIVERY_LEASE_MS,
        AMBIGUOUS_DELIVERY_ERROR,
      );
      if (ambiguous !== null) {
        await this.reconcileTerminal(ambiguous, channel);
        queueMessage.ack();
        return;
      }
      queueMessage.retry({ delaySeconds: 30 });
      return;
    }
    const delivery = claim.delivery;
    if (
      this.workspaceOperational !== undefined &&
      !(await this.workspaceOperational.isOperational(input.workspaceId))
    ) {
      await this.finishRemovedClaim(delivery, channel, dispatchToken);
      queueMessage.ack();
      return;
    }

    const attemptCount = delivery.attemptCount;
    const paid = isPaidChannelType(channel.type);
    let sent: { providerMessageId: string | null };
    let charge: ChargeOutcome | null = null;
    let redactor = new Redactor([]);
    let providerStarted = false;
    try {
      const plaintext = await decryptSecret(
        channel.encryptedConfig,
        this.encryptionKeys,
        {
          type: "notification_channel",
          workspaceId: channel.workspaceId,
          recordId: channel.id,
        },
      );
      const parsedConfig = JSON.parse(plaintext) as unknown;
      redactor = channelConfigRedactor(plaintext, parsedConfig);
      if (!hasRecipientConsent(channel.type, parsedConfig)) {
        await this.skip(
          delivery,
          channel,
          dispatchToken,
          attemptCount,
          "explicit recipient consent is required",
        );
        queueMessage.ack();
        return;
      }
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
          await this.skip(
            delivery,
            channel,
            dispatchToken,
            attemptCount,
            charge.message,
          );
          queueMessage.ack();
          return;
        }
      }
      if (
        this.workspaceOperational !== undefined &&
        !(await this.workspaceOperational.isOperational(input.workspaceId))
      ) {
        if (paid && charge?.ok === true) {
          await this.refundSafely(delivery, "workspace deletion stopped delivery");
        }
        await this.finishRemovedClaim(delivery, channel, dispatchToken);
        queueMessage.ack();
        return;
      }
      providerStarted = true;
      sent = await this.sender.send(
        { type: channel.type, config: parsedConfig, workspaceId: input.workspaceId },
        input.message,
        {
          deliveryId: delivery.id,
          idempotencyKey: delivery.providerIdempotencyKey ?? delivery.id,
          attemptCount,
        },
      );
    } catch (error) {
      const providerOutcome =
        error instanceof NotificationProviderError ? error.outcome : null;
      if (
        providerStarted &&
        (providerOutcome === "AMBIGUOUS" || providerOutcome === null)
      ) {
        const errorSanitized = truncate(
          redactor.redact(errorMessage(error)),
          300,
        );
        const ambiguous = await this.deliveries.markDispatchAmbiguous(
          delivery.id,
          dispatchToken,
          attemptCount,
          errorSanitized,
        );
        if (ambiguous !== null) {
          await this.reconcileTerminal(ambiguous, channel);
        }
        logEvent("notification_delivery_ambiguous", {
          deliveryId: delivery.id,
          channelId: channel.id,
          attemptCount,
          error: errorSanitized,
        });
        queueMessage.ack();
        return;
      }
      if (attemptCount < 3) {
        await this.deliveries.finishDispatch(delivery.id, dispatchToken, {
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
      const failed = await this.deliveries.finishDispatch(
        delivery.id,
        dispatchToken,
        {
          status: "FAILED",
          errorSanitized,
          attemptCount,
        },
      );
      if (paid) {
        await this.refundSafely(delivery, "provider delivery failed");
      }
      // Only the worker that owned the dispatch fence records the outcome.
      if (failed) {
        await this.trackOutcome(ACTIVITY_EVENTS.alertFailed, delivery, channel);
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
    const finalized = await this.deliveries.finishDispatch(
      delivery.id,
      dispatchToken,
      {
      status: "SENT",
      providerMessageId: sent.providerMessageId,
      errorSanitized: null,
      attemptCount,
      sentAt,
      ...cost,
      },
    );
    if (!finalized) {
      const accepted = await this.deliveries.recordProviderAcceptance(
        delivery.id,
        delivery.providerIdempotencyKey ?? delivery.id,
        sent.providerMessageId,
        sentAt,
      );
      if (!accepted) {
        throw new Error("Provider acceptance could not be fenced locally");
      }
    }
    // Recorded once the SENT state is persisted; replays of an already
    // terminal delivery only reconcile local effects and never reach here.
    await this.trackOutcome(ACTIVITY_EVENTS.alertSent, delivery, channel);
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
    dispatchToken: string,
    attemptCount: number,
    reason: string,
  ): Promise<void> {
    const failed = await this.deliveries.finishDispatch(
      delivery.id,
      dispatchToken,
      {
        status: "FAILED",
        errorSanitized: reason,
        attemptCount,
      },
    );
    if (failed) {
      await this.trackOutcome(ACTIVITY_EVENTS.alertFailed, delivery, channel);
    }
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
    // A duplicate Queue message can observe a channel being disabled while an
    // earlier owner is already inside the provider call. Claim the READY row
    // first so this local cancellation cannot erase that owner's fenced state.
    const claimedAt = this.clock.now();
    const dispatchToken = crypto.randomUUID();
    const claim = await this.deliveries.beginDispatch(
      delivery.workspaceId,
      delivery.id,
      dispatchToken,
      claimedAt,
      claimedAt - DELIVERY_LEASE_MS,
    );
    if (claim === null) return;
    const failed = await this.deliveries.finishDispatch(
      delivery.id,
      dispatchToken,
      {
        status: "FAILED",
        errorSanitized: "channel removed",
        attemptCount: claim.delivery.attemptCount,
      },
    );
    if (!failed) return;
    await this.trackOutcome(ACTIVITY_EVENTS.alertFailed, claim.delivery, channel);
    await this.reconcileTerminal(
      {
        ...claim.delivery,
        status: "FAILED",
        errorSanitized: "channel removed",
      },
      channel,
    );
    logEvent("notification_delivery_failed", {
      deliveryId: delivery.id,
      channelId: delivery.notificationChannelId,
      attemptCount: claim.delivery.attemptCount,
      error: "channel removed",
    });
  }

  private async finishRemovedClaim(
    delivery: NotificationDelivery,
    channel: NotificationChannel,
    dispatchToken: string,
  ): Promise<void> {
    const errorSanitized = "workspace is being deleted";
    const finished = await this.deliveries.finishDispatch(
      delivery.id,
      dispatchToken,
      {
        status: "FAILED",
        errorSanitized,
        attemptCount: delivery.attemptCount,
      },
    );
    if (!finished) return;
    // No activity event: the workspace is being deleted and its events go
    // with it.
    await this.reconcileTerminal(
      { ...delivery, status: "FAILED", errorSanitized },
      channel,
    );
  }

  /**
   * Records the terminal outcome of a delivery exactly where it transitions,
   * never from `reconcileTerminal`, which replays for terminal deliveries.
   */
  private async trackOutcome(
    type:
      | typeof ACTIVITY_EVENTS.alertSent
      | typeof ACTIVITY_EVENTS.alertFailed,
    delivery: NotificationDelivery,
    channel: NotificationChannel | null,
  ): Promise<void> {
    await this.track?.execute({
      type,
      userId: null,
      workspaceId: delivery.workspaceId,
      source: "server",
      resourceId: delivery.id,
      properties: {
        channelId: delivery.notificationChannelId,
        channelType: channel?.type ?? null,
        incidentId: delivery.incidentId,
      },
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
    const ambiguous = delivery.dispatchState === "AMBIGUOUS";
    if (
      delivery.status !== "SENT" &&
      delivery.status !== "FAILED" &&
      !ambiguous
    ) {
      return;
    }
    const terminalStatus = ambiguous ? "AMBIGUOUS" : delivery.status;
    if (channel !== null) {
      await this.channels.setLastDeliveryStatus(channel.id, terminalStatus);
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
      status: delivery.status === "SENT" ? "SENT" : "FAILED",
      ...((delivery.status === "FAILED" || ambiguous) &&
      delivery.errorSanitized !== null &&
      delivery.errorSanitized.length > 0
        ? { detail: delivery.errorSanitized }
        : {}),
    });
  }
}
