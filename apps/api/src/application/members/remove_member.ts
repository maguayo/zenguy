import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import { can } from "../../domain/workspaces/permissions";
import type { MemberRepo } from "../../domain/workspaces/repo";
import type { Role } from "../../domain/workspaces/types";
import type { User } from "../../domain/users/types";
import { forbidden, notFound } from "../../shared/errors";
import type { WriteAudit } from "../audit/write_audit";

export class RemoveMember {
  constructor(
    private readonly members: MemberRepo,
    private readonly audit: Pick<WriteAudit, "execute">,
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

    await this.members.remove(input.workspaceId, target.userId);
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
