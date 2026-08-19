import type { UserRepo } from "../../domain/users/repo";
import type {
  InvitationRepo,
  WorkspaceRepo,
} from "../../domain/workspaces/repo";
import type { WorkspaceInvitation } from "../../domain/workspaces/types";
import type { Clock } from "../../shared/clock";
import { sha256Hex } from "../../shared/crypto";
import { AppError } from "../../shared/errors";

export interface PublicInvitationOutput {
  workspaceName: string;
  inviterName: string;
  email: string;
  role: WorkspaceInvitation["role"];
  expiresAt: number;
}

function gone(): AppError {
  return new AppError("GONE", "This invitation is invalid or has expired");
}

export class GetInvitationPublic {
  constructor(
    private readonly invitations: InvitationRepo,
    private readonly workspaces: WorkspaceRepo,
    private readonly users: UserRepo,
    private readonly clock: Clock,
  ) {}

  async execute(input: { tokenPlain: string }): Promise<PublicInvitationOutput> {
    const invitation = await this.invitations.findValidByHash(
      await sha256Hex(input.tokenPlain),
      this.clock.now(),
    );
    if (invitation === null) throw gone();
    const workspace = await this.workspaces.findById(invitation.workspaceId);
    const inviter = await this.users.findById(invitation.invitedBy);
    if (workspace === null || inviter === null) throw gone();
    return {
      workspaceName: workspace.name,
      inviterName: inviter.name,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
    };
  }
}
