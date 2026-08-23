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
import {
  channelConfigSchema,
  hasRecipientConsent,
  type ChannelConfig,
  type ChannelType,
} from "../../domain/channels/types";
import { can } from "../../domain/workspaces/permissions";
import type { Role } from "../../domain/workspaces/types";
import type { User } from "../../domain/users/types";
import type { Clock } from "../../shared/clock";
import type { AppConfig } from "../../shared/config";
import { RATE_LIMITS } from "../../shared/constants";
import { decryptSecret, sha256Hex } from "../../shared/crypto";
import { forbidden, notFound, validation } from "../../shared/errors";
import type { IdGenerator } from "../../shared/ids";
import {
  enforceRateLimitScopes,
  type RateLimiter,
} from "../../shared/ratelimit";
import { Redactor, truncate } from "../../shared/redact";
import type { PaidDeliveryCharger } from "../alerts/charge_paid_delivery";
import { deliveryOutput, type DeliveryOutput } from "./types";

export interface WorkspaceOperational {
  isOperational(workspaceId: string): Promise<boolean>;
}

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

function destinationValues(type: ChannelType, config: ChannelConfig): string[] {
  switch (type) {
    case "EMAIL":
      return "emails" in config
        ? config.emails.map((email) => email.trim().toLowerCase())
        : [];
    case "SMS":
    case "WHATSAPP":
    case "CALL":
      return "phoneNumber" in config ? [config.phoneNumber] : [];
    case "SLACK":
    case "DISCORD":
      return "webhookUrl" in config ? [config.webhookUrl] : [];
    case "PUSH":
      // The workspace scope already uniquely identifies this audience.
      return [];
  }
}

function rateAddress(value: string | undefined): string {
  const raw = value?.trim().toLowerCase() ?? "unknown";
  return /^[0-9a-f:.]{1,64}$/iu.test(raw) ? raw : "invalid";
}

export class TestChannel {
  constructor(
    private readonly channels: ChannelRepo,
    private readonly deliveries: DeliveryRepo,
    private readonly subscriptions: SubscriptionRepo,
    private readonly sender: ChannelSender,
    private readonly rateLimiter: RateLimiter,
    private readonly audit: Pick<WriteAudit, "execute">,
    private readonly config: Pick<AppConfig, "appUrl" | "encryptionKeys">,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly charger: PaidDeliveryCharger,
    private readonly workspaceOperational?: WorkspaceOperational,
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
    await ensureActiveSubscription(
      this.subscriptions,
      input.workspaceId,
      this.clock.now(),
    );
    const channel = await this.channels.findById(
      input.workspaceId,
      input.channelId,
    );
    if (channel === null) throw notFound("Notification channel");
    if (
      isPaidChannelType(channel.type) &&
      !can(input.actorRole, "paid_alerts.manage")
    ) {
      throw forbidden();
    }
    const address = rateAddress(input.ip);
    const addressDigest = await sha256Hex(address);
    await enforceRateLimitScopes(
      this.rateLimiter,
      [
        `channel_test:workspace:${input.workspaceId}`,
        `channel_test:actor:${input.actor.id}`,
        `channel_test:ip:${addressDigest}`,
      ],
      RATE_LIMITS.channel_test,
    );

    // Resolve the write-only destination before creating a delivery. This
    // gives every recipient a stable budget independent of channel/account
    // rotation without persisting the recipient itself in rate-limit keys.
    const plaintext = await decryptSecret(
      channel.encryptedConfig,
      this.config.encryptionKeys,
      {
        type: "notification_channel",
        workspaceId: channel.workspaceId,
        recordId: channel.id,
      },
    );
    const parsedConfig = channelConfigSchema(channel.type).parse(
      JSON.parse(plaintext) as unknown,
    );
    if (!hasRecipientConsent(channel.type, parsedConfig)) {
      throw validation([
        {
          field: "config.consent",
          message: "Explicit recipient consent is required",
        },
      ]);
    }
    const destinationKeys = await Promise.all(
      [...new Set(destinationValues(channel.type, parsedConfig))].map(
        async (destination) => {
          const digest = await sha256Hex(`${channel.type}:${destination}`);
          return `channel_test:destination:${digest}`;
        },
      ),
    );
    if (destinationKeys.length > 0) {
      await enforceRateLimitScopes(
        this.rateLimiter,
        destinationKeys,
        RATE_LIMITS.channel_test,
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
    let redactor = channelConfigRedactor(plaintext, parsedConfig);
    const paid = isPaidChannelType(channel.type);
    let charged = false;
    try {
      if (!(await this.isWorkspaceOperational(input.workspaceId))) {
        return this.stopForDeletion(delivery, channel);
      }
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
      // Charge/decrypt can yield to another isolate. Re-read the tombstone at
      // the last possible point before the irreversible provider call.
      if (!(await this.isWorkspaceOperational(input.workspaceId))) {
        if (charged) {
          await this.charger.refund({
            workspaceId: input.workspaceId,
            deliveryId: delivery.id,
            reason: "workspace deletion requested",
          });
        }
        return this.stopForDeletion(delivery, channel);
      }
      const sent = await this.sender.send(
        { type: channel.type, config: parsedConfig, workspaceId: input.workspaceId },
        message,
        {
          deliveryId: delivery.id,
          idempotencyKey: delivery.id,
          attemptCount: 1,
        },
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

  private async isWorkspaceOperational(workspaceId: string): Promise<boolean> {
    return (
      this.workspaceOperational === undefined ||
      (await this.workspaceOperational.isOperational(workspaceId))
    );
  }

  private async stopForDeletion(
    delivery: NotificationDelivery,
    channel: { id: string },
  ): Promise<DeliveryOutput> {
    const stopped = {
      ...delivery,
      status: "FAILED" as const,
      errorSanitized: "workspace deletion requested",
    };
    await this.deliveries.update(delivery.id, {
      status: "FAILED",
      errorSanitized: stopped.errorSanitized,
      attemptCount: delivery.attemptCount,
    });
    await this.channels.setLastDeliveryStatus(channel.id, "FAILED");
    // Do not write a post-tombstone audit row containing actor/resource data;
    // the deletion audit was committed before the saga began.
    return deliveryOutput(stopped);
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
