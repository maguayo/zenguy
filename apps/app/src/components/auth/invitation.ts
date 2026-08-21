import type { PublicInvitation, User } from "@/api/types";

export type InvitationAccessMode = "different" | "matching" | "signedOut";

export function invitationAccessMode(
  invitation: PublicInvitation,
  user: User | null,
): InvitationAccessMode {
  if (!user) return "signedOut";
  return user.email.toLowerCase() === invitation.email.toLowerCase()
    ? "matching"
    : "different";
}

export function invitationRoleLabel(role: PublicInvitation["role"]): "Admin" | "Member" {
  return role === "ADMIN" ? "Admin" : "Member";
}
