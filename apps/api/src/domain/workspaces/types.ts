export type Role = "OWNER" | "ADMIN" | "MEMBER";

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  ownerUserId: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface WorkspaceMember {
  id: string;
  workspaceId: string;
  userId: string;
  role: Role;
  invitedBy: string | null;
  joinedAt: number;
}

export interface WorkspaceInvitation {
  id: string;
  workspaceId: string;
  email: string;
  role: Exclude<Role, "OWNER">;
  tokenHash: string;
  invitedBy: string;
  expiresAt: number;
  acceptedAt: number | null;
  revokedAt: number | null;
  createdAt: number;
}
