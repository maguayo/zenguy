import type { UserRepo } from "../../domain/users/repo";
import { can } from "../../domain/workspaces/permissions";
import type { InvitationRepo } from "../../domain/workspaces/repo";
import type { Role } from "../../domain/workspaces/types";
import { forbidden } from "../../shared/errors";
import { invitationOutput, type InvitationOutput } from "./types";

export class ListInvitations {
  constructor(
    private readonly invitations: InvitationRepo,
    private readonly users: UserRepo,
  ) {}

  async execute(input: {
    workspaceId: string;
    actorRole: Role;
  }): Promise<InvitationOutput[]> {
    if (!can(input.actorRole, "members.invite")) throw forbidden();
    const invitations = await this.invitations.findPending(input.workspaceId);
    return Promise.all(
      invitations.map(async (invitation) => {
        const inviter = await this.users.findById(invitation.invitedBy);
        return invitationOutput(invitation, inviter?.name ?? "Unknown user");
      }),
    );
  }
}
