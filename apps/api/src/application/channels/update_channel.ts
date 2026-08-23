import type { WriteAudit } from "../audit/write_audit";
import { loadPaidChannelContext } from "../alerts/settings";
import { ensureActiveSubscription } from "../billing/ensure_active_subscription";
import type { AlertRepo } from "../../domain/alerts/repo";
import { isPaidChannelType } from "../../domain/alerts/types";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import type { ChannelRepo, ChannelUpdate } from "../../domain/channels/repo";
import { can } from "../../domain/workspaces/permissions";
import type { Role } from "../../domain/workspaces/types";
import type { User } from "../../domain/users/types";
import type { Clock } from "../../shared/clock";
import { encryptSecret } from "../../shared/crypto";
import { forbidden, notFound, validation } from "../../shared/errors";
import {
  PAID_CHANNELS_OFF_MESSAGE,
  PUSH_DEFAULT_REQUIRED_MESSAGE,
} from "./create_channel";
import { channelName, parseChannelConfig } from "./input";
import { channelOutput, type ChannelOutput } from "./types";

export class UpdateChannel {
  constructor(
    private readonly channels: ChannelRepo,
    private readonly subscriptions: SubscriptionRepo,
    private readonly alerts: Pick<AlertRepo, "findSettings" | "getBalanceCents">,
    private readonly audit: Pick<WriteAudit, "execute">,
    private readonly encryptionKey: Uint8Array,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    workspaceId: string;
    channelId: string;
    actor: User;
    actorRole: Role;
    name?: string;
    enabled?: boolean;
    isDefault?: boolean;
    config?: unknown;
    ip?: string;
  }): Promise<ChannelOutput> {
    if (!can(input.actorRole, "channels.manage")) throw forbidden();
    await ensureActiveSubscription(this.subscriptions, input.workspaceId);
    if (
      input.name === undefined &&
      input.enabled === undefined &&
      input.isDefault === undefined &&
      input.config === undefined
    ) {
      throw validation([
        { field: "body", message: "At least one field is required" },
      ]);
    }
    const channel = await this.channels.findById(
      input.workspaceId,
      input.channelId,
    );
    if (channel === null) throw notFound("Notification channel");
    if (channel.type === "PUSH" && input.isDefault === false) {
      throw validation([
        { field: "isDefault", message: PUSH_DEFAULT_REQUIRED_MESSAGE },
      ]);
    }
    const paid = await loadPaidChannelContext(this.alerts, input.workspaceId);
    if (
      input.enabled === true &&
      !channel.enabled &&
      isPaidChannelType(channel.type) &&
      !paid.enabled
    ) {
      throw validation([
        { field: "enabled", message: PAID_CHANNELS_OFF_MESSAGE },
      ]);
    }

    const changes: ChannelUpdate = {};
    if (input.name !== undefined) changes.name = channelName(input.name);
    if (input.enabled !== undefined) changes.enabled = input.enabled;
    if (input.isDefault !== undefined) changes.isDefault = input.isDefault;
    if (input.config !== undefined) {
      const config = parseChannelConfig(channel.type, input.config);
      changes.encryptedConfig = await encryptSecret(
        JSON.stringify(config),
        this.encryptionKey,
      );
    }
    const now = this.clock.now();
    await this.channels.update(channel.id, changes, now);
    const updated = { ...channel, ...changes, updatedAt: now };
    await this.audit.execute({
      workspaceId: input.workspaceId,
      actorUserId: input.actor.id,
      action: AUDIT_ACTIONS.channelUpdated,
      resourceType: "notification_channel",
      resourceId: channel.id,
      metadata: {
        name: updated.name,
        type: updated.type,
        changedFields: Object.keys(changes).map((field) =>
          field === "encryptedConfig" ? "config" : field,
        ),
      },
      ip: input.ip,
    });
    return channelOutput(updated, this.encryptionKey, paid);
  }
}
