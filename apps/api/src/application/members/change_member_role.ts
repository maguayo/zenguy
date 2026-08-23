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
import { memberOutput, type MemberOutput } from "./types";

export class ChangeMemberRole {
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
    role: "ADMIN" | "MEMBER";
    ip?: string;
  }): Promise<MemberOutput> {
    if (!can(input.actorRole, "admins.manage")) throw forbidden();
    const target = await this.members.find(
      input.workspaceId,
      input.targetUserId,
    );
    if (target === null) throw notFound("Member");
    if (target.role === "OWNER") {
      throw forbidden("The owner's role cannot be changed");
    }

    const now = this.clock.now();
    await this.members.updateRole(
      input.workspaceId,
      input.targetUserId,
      input.role,
      now,
    );
    if (input.role === "MEMBER" && target.role !== "MEMBER") {
      await Promise.all([
        this.invitations.revokeUnauthorizedByInviter(
          input.workspaceId,
          input.targetUserId,
          "MEMBER",
          now,
        ),
        this.apiKeys.revokeAllCreatedBy(
          input.workspaceId,
          input.targetUserId,
          now,
        ),
      ]);
    }
    await this.audit.execute({
      workspaceId: input.workspaceId,
      actorUserId: input.actor.id,
      action: AUDIT_ACTIONS.memberRoleChanged,
      resourceType: "member",
      resourceId: input.targetUserId,
      metadata: {
        targetUserId: input.targetUserId,
        from: target.role,
        to: input.role,
      },
      ip: input.ip,
    });

    const updated = (await this.members.list(input.workspaceId)).find(
      (member) => member.userId === input.targetUserId,
    );
    if (updated === undefined) throw notFound("Member");
    return memberOutput(updated);
  }
}
