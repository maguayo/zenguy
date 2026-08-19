import type { WriteAudit } from "../audit/write_audit";
import { ensureActiveSubscription } from "../billing/ensure_active_subscription";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import type { ChannelRepo } from "../../domain/channels/repo";
import type { ChannelType } from "../../domain/channels/types";
import { can } from "../../domain/workspaces/permissions";
import type { Role } from "../../domain/workspaces/types";
import type { User } from "../../domain/users/types";
import type { Clock } from "../../shared/clock";
import { encryptSecret } from "../../shared/crypto";
import { forbidden } from "../../shared/errors";
import type { IdGenerator } from "../../shared/ids";
import { channelName, parseChannelConfig } from "./input";
import { channelOutput, type ChannelOutput } from "./types";

export class CreateChannel {
  constructor(
    private readonly channels: ChannelRepo,
    private readonly subscriptions: SubscriptionRepo,
    private readonly audit: Pick<WriteAudit, "execute">,
    private readonly encryptionKey: Uint8Array,
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
    ip?: string;
  }): Promise<ChannelOutput> {
    if (!can(input.actorRole, "channels.manage")) throw forbidden();
    await ensureActiveSubscription(this.subscriptions, input.workspaceId);
    const name = channelName(input.name);
    const config = parseChannelConfig(input.type, input.config);
    const now = this.clock.now();
    const channel = {
      id: this.ids.newId("ch"),
      workspaceId: input.workspaceId,
      name,
      type: input.type,
      encryptedConfig: await encryptSecret(
        JSON.stringify(config),
        this.encryptionKey,
      ),
      enabled: true,
      verifiedAt: null,
      lastDeliveryStatus: null,
      createdBy: input.actor.id,
      createdAt: now,
      updatedAt: now,
    };
    await this.channels.insert(channel);
    await this.audit.execute({
      workspaceId: input.workspaceId,
      actorUserId: input.actor.id,
      action: AUDIT_ACTIONS.channelCreated,
      resourceType: "notification_channel",
      resourceId: channel.id,
      metadata: { name: channel.name, type: channel.type },
      ip: input.ip,
    });
    return channelOutput(channel, this.encryptionKey);
  }
}
