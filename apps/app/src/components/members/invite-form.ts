import { z } from "zod";

import { ApiError } from "@/lib/api";

import { type AssignableRole, roleLabel } from "./member-policy";

// Ported from apps/frontend/src/pages/members/MembersPage.tsx (InviteMemberModal).
export const inviteSchema = z.object({
  email: z.email("Enter a valid email address."),
  role: z.enum(["ADMIN", "MEMBER"]),
});

export type InviteValues = z.infer<typeof inviteSchema>;

export function inviteDefaults(): InviteValues {
  return { email: "", role: "MEMBER" };
}

/** The API receives a normalised address; the toast echoes the same one. */
export function inviteInput(values: InviteValues): { email: string; role: AssignableRole } {
  return { email: values.email.trim().toLowerCase(), role: values.role };
}

export interface InviteRoleOption {
  label: string;
  value: AssignableRole;
}

/** Member is always offered; Admin only to actors who may manage admins. */
export function inviteRoleOptions(canManageAdmins: boolean): InviteRoleOption[] {
  return [
    { label: roleLabel.MEMBER, value: "MEMBER" },
    ...(canManageAdmins ? [{ label: roleLabel.ADMIN, value: "ADMIN" as const }] : []),
  ];
}

export const inviteConflictMessage = "Already a member.";
export const inviteRateLimitedMessage = "Too many invitations sent. Try again in a moment.";

export interface InviteErrorPresentation {
  field: "email" | "root";
  message: string;
}

/** Errors the form explains inline instead of through the generic toast. */
export function inviteErrorPresentation(error: unknown): InviteErrorPresentation | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code === "CONFLICT") return { field: "email", message: inviteConflictMessage };
  if (error.code === "RATE_LIMITED") return { field: "root", message: inviteRateLimitedMessage };
  return null;
}

export function invitationSentMessage(email: string): string {
  return `Invitation sent to ${email}`;
}
