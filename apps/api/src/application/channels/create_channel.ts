import type { WriteAudit } from "../audit/write_audit";
import { loadPaidChannelContext } from "../alerts/settings";
import { ensureActiveSubscription } from "../billing/ensure_active_subscription";
import type { AlertRepo } from "../../domain/alerts/repo";
import { isPaidChannelType } from "../../domain/alerts/types";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import type { ChannelRepo } from "../../domain/channels/repo";
import type {
  ChannelType,
  NotificationChannel,
} from "../../domain/channels/types";
import { can } from "../../domain/workspaces/permissions";
import type { Role } from "../../domain/workspaces/types";
import type { User } from "../../domain/users/types";
import type { Clock } from "../../shared/clock";
import {
  encryptSecret,
  type EncryptionKeyring,
} from "../../shared/crypto";
import { forbidden, throwIfCollectionCap, validation } from "../../shared/errors";
import type { IdGenerator } from "../../shared/ids";
import { writeWithActiveDataKeyRetry } from "../security/write_with_active_data_key";
import { channelName, parseChannelConfig } from "./input";
import { channelOutput, type ChannelOutput } from "./types";

export const PAID_CHANNELS_OFF_MESSAGE =
  "Turn on SMS & calls under Alerts before adding this channel";
export const PUSH_CHANNEL_EXISTS_MESSAGE =
  "This workspace already has a mobile push channel";
export const PUSH_DEFAULT_REQUIRED_MESSAGE =
  "Mobile push is always a default channel";

export class CreateChannel {
  constructor(
    private readonly channels: ChannelRepo,
    private readonly subscriptions: SubscriptionRepo,
    private readonly alerts: Pick<AlertRepo, "findSettings" | "getBalanceCents">,
    private readonly audit: Pick<WriteAudit, "execute">,
    private readonly encryptionKeys: EncryptionKeyring,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: {
    workspaceId: string;
    actor: User;
    actorRole: Role;
    name: string;
    type: ChannelType;
    config: unknown;
    isDefault?: boolean;
    ip?: string;
  }): Promise<ChannelOutput> {
    if (!can(input.actorRole, "channels.manage")) throw forbidden();
    if (
      isPaidChannelType(input.type) &&
      !can(input.actorRole, "paid_alerts.manage")
    ) {
      throw forbidden();
    }
    await ensureActiveSubscription(
      this.subscriptions,
      input.workspaceId,
      this.clock.now(),
    );
    const name = channelName(input.name);
    const config = parseChannelConfig(input.type, input.config);
    const paid = await loadPaidChannelContext(this.alerts, input.workspaceId);
    if (isPaidChannelType(input.type) && !paid.enabled) {
      throw validation([{ field: "type", message: PAID_CHANNELS_OFF_MESSAGE }]);
    }
    if (
      input.type === "PUSH" &&
      (await this.channels.list(input.workspaceId)).some(
        (channel) => channel.type === "PUSH",
      )
    ) {
      throw validation([{ field: "type", message: PUSH_CHANNEL_EXISTS_MESSAGE }]);
    }
    const now = this.clock.now();
    const channelId = this.ids.newId("ch");
    let channel: NotificationChannel;
    try {
      channel = await writeWithActiveDataKeyRetry(
        async () => ({
          id: channelId,
          workspaceId: input.workspaceId,
          name,
          type: input.type,
          encryptedConfig: await encryptSecret(
            JSON.stringify(config),
            this.encryptionKeys,
            {
              type: "notification_channel",
              workspaceId: input.workspaceId,
              recordId: channelId,
            },
          ),
          enabled: true,
          isDefault: input.type === "PUSH" || input.isDefault === true,
          verifiedAt: null,
          lastDeliveryStatus: null,
          createdBy: input.actor.id,
          createdAt: now,
          updatedAt: now,
        }),
        (candidate) => this.channels.insert(candidate),
      );
    } catch (error) {
      throwIfCollectionCap(error);
      throw error;
    }
    await this.audit.execute({
      workspaceId: input.workspaceId,
      actorUserId: input.actor.id,
      action: AUDIT_ACTIONS.channelCreated,
      resourceType: "notification_channel",
      resourceId: channel.id,
      metadata: {
        name: channel.name,
        type: channel.type,
        isDefault: channel.isDefault === true,
      },
      ip: input.ip,
    });
    return channelOutput(channel, this.encryptionKeys, paid);
  }
}
