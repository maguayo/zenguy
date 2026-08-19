import type { WriteAudit } from "../audit/write_audit";
import { ensureActiveSubscription } from "../billing/ensure_active_subscription";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import type { ChannelRepo } from "../../domain/channels/repo";
import { can } from "../../domain/workspaces/permissions";
import type { Role } from "../../domain/workspaces/types";
import type { User } from "../../domain/users/types";
import { forbidden, notFound } from "../../shared/errors";

export class DeleteChannel {
  constructor(
    private readonly channels: ChannelRepo,
    private readonly subscriptions: SubscriptionRepo,
    private readonly audit: Pick<WriteAudit, "execute">,
  ) {}

  async execute(input: {
    workspaceId: string;
    channelId: string;
    actor: User;
    actorRole: Role;
    ip?: string;
  }): Promise<void> {
    if (!can(input.actorRole, "channels.manage")) throw forbidden();
    await ensureActiveSubscription(this.subscriptions, input.workspaceId);
    const channel = await this.channels.findById(
      input.workspaceId,
      input.channelId,
    );
    if (channel === null) throw notFound("Notification channel");
    await this.channels.delete(channel.id);
    await this.audit.execute({
      workspaceId: input.workspaceId,
      actorUserId: input.actor.id,
      action: AUDIT_ACTIONS.channelDeleted,
      resourceType: "notification_channel",
      resourceId: channel.id,
      metadata: { name: channel.name, type: channel.type },
      ip: input.ip,
    });
  }
}
