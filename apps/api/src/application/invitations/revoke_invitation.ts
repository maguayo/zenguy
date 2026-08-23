import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import { can } from "../../domain/workspaces/permissions";
import type { InvitationRepo } from "../../domain/workspaces/repo";
import type { Role } from "../../domain/workspaces/types";
import type { User } from "../../domain/users/types";
import type { Clock } from "../../shared/clock";
import { forbidden, notFound } from "../../shared/errors";
import type { WriteAudit } from "../audit/write_audit";

export class RevokeInvitation {
  constructor(
    private readonly invitations: InvitationRepo,
    private readonly clock: Clock,
    private readonly audit: Pick<WriteAudit, "execute">,
  ) {}

  async execute(input: {
    workspaceId: string;
    invitationId: string;
    actor: User;
    actorRole: Role;
    ip?: string;
  }): Promise<void> {
    if (!can(input.actorRole, "members.invite")) throw forbidden();
    const invitation = (await this.invitations.findPending(input.workspaceId)).find(
      (candidate) => candidate.id === input.invitationId,
    );
    if (invitation === undefined) throw notFound("Invitation");
    if (!(await this.invitations.revoke(invitation.id, this.clock.now()))) {
      throw notFound("Invitation");
    }
    await this.audit.execute({
      workspaceId: input.workspaceId,
      actorUserId: input.actor.id,
      action: AUDIT_ACTIONS.memberInvitationRevoked,
      resourceType: "invitation",
      resourceId: invitation.id,
      metadata: { email: invitation.email, role: invitation.role },
      ip: input.ip,
    });
  }
}
