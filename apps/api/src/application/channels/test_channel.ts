import type { WriteAudit } from "../audit/write_audit";
import { ensureActiveSubscription } from "../billing/ensure_active_subscription";
import { isPaidChannelType } from "../../domain/alerts/types";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import type {
  ChannelRepo,
  DeliveryRepo,
} from "../../domain/channels/repo";
import type { ChannelSender } from "../../domain/channels/notifier";
import { buildNotificationMessage } from "../../domain/channels/templates";
import type { NotificationDelivery } from "../../domain/channels/types";
import { can } from "../../domain/workspaces/permissions";
import type { Role } from "../../domain/workspaces/types";
import type { User } from "../../domain/users/types";
import type { Clock } from "../../shared/clock";
import type { AppConfig } from "../../shared/config";
import { RATE_LIMITS } from "../../shared/constants";
import { decryptSecret } from "../../shared/crypto";
import { AppError, forbidden, notFound } from "../../shared/errors";
import type { IdGenerator } from "../../shared/ids";
import type { RateLimiter } from "../../shared/ratelimit";
import { Redactor, truncate } from "../../shared/redact";
import type { PaidDeliveryCharger } from "../alerts/charge_paid_delivery";
import { deliveryOutput, type DeliveryOutput } from "./types";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "notification error";
}

function configValues(value: unknown): string[] {
  if (typeof value === "string") return value.length === 0 ? [] : [value];
  if (Array.isArray(value)) return value.flatMap(configValues);
  if (value !== null && typeof value === "object") {
    return Object.values(value).flatMap(configValues);
  }
  return [];
}

function channelConfigRedactor(plaintext: string, config?: unknown): Redactor {
  const values =
    config === undefined
      ? [plaintext]
      : [plaintext, ...configValues(config)];
  return new Redactor(
    values.map((value, index) => ({
      key: `CHANNEL_CONFIG_${index + 1}`,
      value,
    })),
  );
}

export class TestChannel {
  constructor(
    private readonly channels: ChannelRepo,
    private readonly deliveries: DeliveryRepo,
    private readonly subscriptions: SubscriptionRepo,
    private readonly sender: ChannelSender,
    private readonly rateLimiter: RateLimiter,
    private readonly audit: Pick<WriteAudit, "execute">,
    private readonly config: Pick<AppConfig, "appUrl" | "encryptionKey">,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly charger: PaidDeliveryCharger,
  ) {}

  async execute(input: {
    workspaceId: string;
    workspaceName: string;
    channelId: string;
    actor: User;
    actorRole: Role;
    ip?: string;
  }): Promise<DeliveryOutput> {
    if (!can(input.actorRole, "channels.manage")) throw forbidden();
    await ensureActiveSubscription(this.subscriptions, input.workspaceId);
    const channel = await this.channels.findById(
      input.workspaceId,
      input.channelId,
    );
    if (channel === null) throw notFound("Notification channel");
    const rate = await this.rateLimiter.hit(
      `channel_test:${input.workspaceId}:${channel.id}`,
      RATE_LIMITS.channel_test.limit,
      RATE_LIMITS.channel_test.windowSeconds,
    );
    if (!rate.allowed) {
      throw new AppError(
        "RATE_LIMITED",
        "Too many requests",
        undefined,
        rate.retryAfterSeconds,
      );
    }

    const now = this.clock.now();
    const delivery: NotificationDelivery = {
      id: this.ids.newId("del"),
      workspaceId: input.workspaceId,
      incidentId: null,
      notificationChannelId: channel.id,
      eventType: "TEST",
      status: "PENDING",
      providerMessageId: null,
      attemptCount: 0,
      errorSanitized: null,
      sentAt: null,
      createdAt: now,
    };
    await this.deliveries.insert(delivery);
    const message = buildNotificationMessage({
      eventType: "TEST",
      resourceType: "BROWSER_TEST",
      resourceName: channel.name,
      workspaceName: input.workspaceName,
      appUrl: this.config.appUrl,
      workspaceId: input.workspaceId,
      occurredAtIso: new Date(now).toISOString(),
    });

    let result: NotificationDelivery;
    let redactor = new Redactor([]);
    const paid = isPaidChannelType(channel.type);
    let charged = false;
    try {
      const plaintext = await decryptSecret(
        channel.encryptedConfig,
        this.config.encryptionKey,
      );
      redactor = channelConfigRedactor(plaintext);
      const parsedConfig = JSON.parse(plaintext) as unknown;
      redactor = channelConfigRedactor(plaintext, parsedConfig);
      let cost: Pick<NotificationDelivery, "costCents" | "destinationCountry"> =
        {};
      if (paid) {
        const charge = await this.charger.charge({
          workspaceId: input.workspaceId,
          deliveryId: delivery.id,
          channelType: channel.type,
          config: parsedConfig,
        });
        if (!charge.ok) {
          result = {
            ...delivery,
            status: "FAILED",
            attemptCount: 1,
            errorSanitized: charge.message,
          };
          await this.deliveries.update(delivery.id, {
            status: "FAILED",
            errorSanitized: charge.message,
            attemptCount: 1,
          });
          await this.channels.setLastDeliveryStatus(channel.id, "FAILED");
          return this.finish(input, channel, result);
        }
        charged = true;
        cost = {
          costCents: charge.costCents,
          destinationCountry: charge.destination.name,
        };
      }
      const sent = await this.sender.send(
        { type: channel.type, config: parsedConfig, workspaceId: input.workspaceId },
        message,
      );
      result = {
        ...delivery,
        status: "SENT",
        providerMessageId: sent.providerMessageId,
        attemptCount: 1,
        sentAt: now,
        ...cost,
      };
      await this.deliveries.update(delivery.id, {
        status: "SENT",
        providerMessageId: sent.providerMessageId,
        errorSanitized: null,
        attemptCount: 1,
        sentAt: now,
        ...cost,
      });
      await this.channels.setVerified(channel.id, now);
      await this.channels.setLastDeliveryStatus(channel.id, "SENT");
    } catch (error) {
      const errorSanitized = truncate(
        redactor.redact(errorMessage(error)),
        300,
      );
      result = {
        ...delivery,
        status: "FAILED",
        attemptCount: 1,
        errorSanitized,
      };
      await this.deliveries.update(delivery.id, {
        status: "FAILED",
        errorSanitized,
        attemptCount: 1,
      });
      await this.channels.setLastDeliveryStatus(channel.id, "FAILED");
      if (charged) {
        await this.charger.refund({
          workspaceId: input.workspaceId,
          deliveryId: delivery.id,
          reason: "test notification failed",
        });
      }
    }
    return this.finish(input, channel, result);
  }

  private async finish(
    input: { workspaceId: string; actor: User; ip?: string },
    channel: { id: string; name: string; type: string },
    result: NotificationDelivery,
  ): Promise<DeliveryOutput> {
    await this.audit.execute({
      workspaceId: input.workspaceId,
      actorUserId: input.actor.id,
      action: AUDIT_ACTIONS.channelTested,
      resourceType: "notification_channel",
      resourceId: channel.id,
      metadata: {
        name: channel.name,
        type: channel.type,
        status: result.status,
      },
      ip: input.ip,
    });
    return deliveryOutput(result);
  }
}
