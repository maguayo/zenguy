import type { WriteAudit } from "../audit/write_audit";
import { ensureActiveSubscription } from "../billing/ensure_active_subscription";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import type { SecretRepo } from "../../domain/secrets/repo";
import { can } from "../../domain/workspaces/permissions";
import type { Role } from "../../domain/workspaces/types";
import type { User } from "../../domain/users/types";
import { forbidden, notFound } from "../../shared/errors";

export class DeleteSecret {
  constructor(
    private readonly secrets: SecretRepo,
    private readonly subscriptions: SubscriptionRepo,
    private readonly audit: Pick<WriteAudit, "execute">,
  ) {}

  async execute(input: {
    workspaceId: string;
    secretId: string;
    actor: User;
    actorRole: Role;
    ip?: string;
  }): Promise<void> {
    if (!can(input.actorRole, "secrets.manage")) throw forbidden();
    await ensureActiveSubscription(this.subscriptions, input.workspaceId);
    const secret = await this.secrets.findById(
      input.workspaceId,
      input.secretId,
    );
    if (secret === null) throw notFound("Secret");
    await this.secrets.delete(secret.id);
    await this.audit.execute({
      workspaceId: input.workspaceId,
      actorUserId: input.actor.id,
      action: AUDIT_ACTIONS.secretDeleted,
      resourceType: "secret",
      resourceId: secret.id,
      metadata: { key: secret.key },
      ip: input.ip,
    });
  }
}
