import type { WorkspaceMemberWithUser } from "../../domain/workspaces/repo";
import type { Role } from "../../domain/workspaces/types";

export interface MemberOutput {
  userId: string;
  name: string;
  email: string;
  role: Role;
  joinedAt: number;
}

export function memberOutput(member: WorkspaceMemberWithUser): MemberOutput {
  return {
    userId: member.userId,
    name: member.userName,
    email: member.userEmail,
    role: member.role,
    joinedAt: member.joinedAt,
  };
}
