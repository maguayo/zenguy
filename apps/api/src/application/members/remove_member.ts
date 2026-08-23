import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import { can } from "../../domain/workspaces/permissions";
import type { MemberRepo } from "../../domain/workspaces/repo";
import type { InvitationRepo } from "../../domain/workspaces/repo";
import type { ApiKeyRepo } from "../../domain/api_keys/repo";
import type { Role } from "../../domain/workspaces/types";
import type { User } from "../../domain/users/types";
import { forbidden, notFound } from "../../shared/errors";
import type { WriteAudit } from "../audit/write_audit";
import type { Clock } from "../../shared/clock";

export class RemoveMember {
  constructor(
    private readonly members: MemberRepo,
    private readonly invitations: InvitationRepo,
    private readonly apiKeys: ApiKeyRepo,
    private readonly audit: Pick<WriteAudit, "execute">,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    workspaceId: string;
    actor: User;
    actorRole: Role;
    targetUserId: string;
    ip?: string;
  }): Promise<void> {
    if (!can(input.actorRole, "members.remove")) throw forbidden();
    const target = await this.members.find(
      input.workspaceId,
      input.targetUserId,
    );
    if (target === null) throw notFound("Member");
    if (target.userId === input.actor.id) {
      throw forbidden("You cannot remove yourself");
    }
    if (target.role === "OWNER") {
      throw forbidden("The owner cannot be removed");
    }
    if (input.actorRole === "ADMIN" && target.role !== "MEMBER") {
      throw forbidden("Only the owner can remove admins");
    }

    const now = this.clock.now();
    await this.members.remove(input.workspaceId, target.userId, now);
    await Promise.all([
      this.invitations.revokeUnauthorizedByInviter(
        input.workspaceId,
        target.userId,
        null,
        now,
      ),
      this.apiKeys.revokeAllCreatedBy(input.workspaceId, target.userId, now),
    ]);
    await this.audit.execute({
      workspaceId: input.workspaceId,
      actorUserId: input.actor.id,
      action: AUDIT_ACTIONS.memberRemoved,
      resourceType: "member",
      resourceId: target.userId,
      metadata: { targetUserId: target.userId, role: target.role },
      ip: input.ip,
    });
  }
}
