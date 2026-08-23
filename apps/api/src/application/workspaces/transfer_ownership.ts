import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import { can } from "../../domain/workspaces/permissions";
import type {
  InvitationRepo,
  MemberRepo,
  WorkspaceRepo,
} from "../../domain/workspaces/repo";
import type { Role, Workspace } from "../../domain/workspaces/types";
import type { User } from "../../domain/users/types";
import { conflict, forbidden, notFound } from "../../shared/errors";
import type { Clock } from "../../shared/clock";
import type { WriteAudit } from "../audit/write_audit";

export class TransferOwnership {
  constructor(
    private readonly workspaces: WorkspaceRepo,
    private readonly members: MemberRepo,
    private readonly invitations: InvitationRepo,
    private readonly audit: Pick<WriteAudit, "execute">,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    workspace: Workspace;
    actor: User;
    actorRole: Role;
    newOwnerUserId: string;
    ip?: string;
  }): Promise<{ ok: true }> {
    if (
      !can(input.actorRole, "workspace.transfer") ||
      input.workspace.ownerUserId !== input.actor.id
    ) {
      throw forbidden();
    }
    if (input.newOwnerUserId === input.actor.id) {
      throw conflict("User is already the owner");
    }
    const newOwner = await this.members.find(
      input.workspace.id,
      input.newOwnerUserId,
    );
    if (newOwner === null) throw notFound("Member");

    const now = this.clock.now();
    const transferred = await this.workspaces.transferOwnership(
      input.workspace.id,
      input.actor.id,
      newOwner.userId,
      now,
    );
    if (!transferred) {
      throw conflict("Workspace ownership changed; reload and try again");
    }
    // The former owner is now ADMIN and can no longer grant ADMIN.
    await this.invitations.revokeUnauthorizedByInviter(
      input.workspace.id,
      input.actor.id,
      "ADMIN",
      now,
    );
    await this.audit.execute({
      workspaceId: input.workspace.id,
      actorUserId: input.actor.id,
      action: AUDIT_ACTIONS.workspaceOwnershipTransferred,
      resourceType: "workspace",
      resourceId: input.workspace.id,
      metadata: {
        oldOwnerUserId: input.actor.id,
        newOwnerUserId: newOwner.userId,
      },
      ip: input.ip,
    });
    return { ok: true };
  }
}
