import type { WorkspaceInvitation } from "../../domain/workspaces/types";

export interface InvitationOutput {
  id: string;
  email: string;
  role: WorkspaceInvitation["role"];
  invitedBy: { userId: string; name: string };
  expiresAt: number;
  createdAt: number;
}

export function invitationOutput(
  invitation: WorkspaceInvitation,
  inviterName: string,
): InvitationOutput {
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    invitedBy: { userId: invitation.invitedBy, name: inviterName },
    expiresAt: invitation.expiresAt,
    createdAt: invitation.createdAt,
  };
}
