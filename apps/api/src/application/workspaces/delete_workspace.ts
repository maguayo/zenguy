import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { BillingCanceller } from "../../domain/billing/canceller";
import { can } from "../../domain/workspaces/permissions";
import type { InvitationRepo, WorkspaceRepo } from "../../domain/workspaces/repo";
import type { Role, Workspace } from "../../domain/workspaces/types";
import type { User } from "../../domain/users/types";
import type { Clock } from "../../shared/clock";
import { forbidden, validation } from "../../shared/errors";
import { logEvent } from "../../shared/log";
import type { WriteAudit } from "../audit/write_audit";

export class DeleteWorkspace {
  constructor(
    private readonly workspaces: WorkspaceRepo,
    private readonly invitations: InvitationRepo,
    private readonly billing: BillingCanceller,
    private readonly audit: Pick<WriteAudit, "execute">,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    workspace: Workspace;
    actor: User;
    actorRole: Role;
    confirmName: string;
    ip?: string;
  }): Promise<void> {
    if (
      !can(input.actorRole, "workspace.delete") ||
      input.workspace.ownerUserId !== input.actor.id
    ) {
      throw forbidden();
    }
    if (input.confirmName !== input.workspace.name) {
      throw validation([
        { field: "confirmName", message: "Name does not match" },
      ]);
    }

    const now = this.clock.now();
    await this.audit.execute({
      workspaceId: input.workspace.id,
      actorUserId: input.actor.id,
      action: AUDIT_ACTIONS.workspaceDeleted,
      resourceType: "workspace",
      resourceId: input.workspace.id,
      metadata: { name: input.workspace.name },
      ip: input.ip,
    });
    await this.workspaces.softDelete(input.workspace.id, now);
    await this.invitations.revokeAllForWorkspace(input.workspace.id, now);
    try {
      await this.billing.cancelForWorkspace(input.workspace.id);
    } catch {
      logEvent("billing_cancel_failed", { workspaceId: input.workspace.id });
    }
  }
}
