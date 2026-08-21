import type { Member, Role } from "@/api/types";

// Ported verbatim from apps/frontend/src/pages/members/MembersPage.tsx.

export type AssignableRole = "ADMIN" | "MEMBER";

export const assignableRoles: AssignableRole[] = ["ADMIN", "MEMBER"];

export const roleLabel: Record<Role, string> = {
  ADMIN: "Admin",
  MEMBER: "Member",
  OWNER: "Owner",
};

export interface MemberActionPolicy {
  canChangeRole: boolean;
  canRemove: boolean;
}

/**
 * Owners manage every non-owner; admins may only remove members; nobody acts
 * on themselves or on the owner.
 */
export function memberActionPolicy(
  actorRole: Role,
  actorUserId: string,
  target: Member,
): MemberActionPolicy {
  return {
    canChangeRole: actorRole === "OWNER" && target.role !== "OWNER",
    canRemove:
      actorRole === "OWNER"
        ? target.role !== "OWNER" && target.userId !== actorUserId
        : actorRole === "ADMIN" && target.role === "MEMBER",
  };
}

export function roleChangedMessage(name: string, role: AssignableRole): string {
  return `${name} is now ${role === "ADMIN" ? "an Admin" : "a Member"}`;
}

export function removeMemberTitle(member: Pick<Member, "name">): string {
  return `Remove ${member.name} from this workspace?`;
}

export const removeMemberWarning = "They will lose access to this workspace.";
