import type {
  InvitationOutput,
} from "../../application/invitations/types";
import type { PublicInvitationOutput } from "../../application/invitations/get_invitation_public";

export function presentInvitation(invitation: InvitationOutput) {
  return {
    ...invitation,
    expiresAt: new Date(invitation.expiresAt).toISOString(),
    createdAt: new Date(invitation.createdAt).toISOString(),
  };
}

export function presentPublicInvitation(invitation: PublicInvitationOutput) {
  return {
    ...invitation,
    expiresAt: new Date(invitation.expiresAt).toISOString(),
  };
}
