import type {
  Role,
  Workspace,
  WorkspaceInvitation,
  WorkspaceMember,
} from "./types";

export interface WorkspaceUpdate {
  name?: string;
  timezone?: string;
  ownerUserId?: string;
}

export interface WorkspaceRepo {
  insert(workspace: Workspace): Promise<void>;
  findById(id: string, includeDeleted?: boolean): Promise<Workspace | null>;
  findBySlug(slug: string): Promise<Workspace | null>;
  update(id: string, changes: WorkspaceUpdate, at: number): Promise<void>;
  transferOwnership(
    id: string,
    oldOwnerUserId: string,
    newOwnerUserId: string,
    at: number,
  ): Promise<boolean>;
  softDelete(id: string, at: number): Promise<void>;
  listForUser(
    userId: string,
  ): Promise<{ workspace: Workspace; role: Role }[]>;
}

export type WorkspaceMemberWithUser = WorkspaceMember & {
  userName: string;
  userEmail: string;
};

export interface MemberRepo {
  insert(member: WorkspaceMember): Promise<void>;
  find(workspaceId: string, userId: string): Promise<WorkspaceMember | null>;
  list(workspaceId: string): Promise<WorkspaceMemberWithUser[]>;
  /** Persistent implementations revoke delegated invites/keys/channels atomically on privilege loss. */
  updateRole(
    workspaceId: string,
    userId: string,
    role: Role,
    at?: number,
  ): Promise<void>;
  remove(workspaceId: string, userId: string, at?: number): Promise<void>;
}

export interface InvitationRepo {
  insert(invitation: WorkspaceInvitation): Promise<void>;
  findByHash(hash: string): Promise<WorkspaceInvitation | null>;
  findPending(workspaceId: string): Promise<WorkspaceInvitation[]>;
  findValidByHash(
    hash: string,
    now: number,
  ): Promise<WorkspaceInvitation | null>;
  findPendingByEmail(
    workspaceId: string,
    email: string,
  ): Promise<WorkspaceInvitation | null>;
  /** Atomically validates current inviter authority, joins the actor and consumes the token. */
  acceptByHash(input: {
    hash: string;
    email: string;
    userId: string;
    memberId: string;
    now: number;
  }): Promise<WorkspaceInvitation | null>;
  markAccepted(id: string, at: number): Promise<void>;
  revoke(id: string, at: number): Promise<boolean>;
  revokeUnauthorizedByInviter(
    workspaceId: string,
    inviterUserId: string,
    currentRole: Role | null,
    at: number,
  ): Promise<number>;
  revokeAllForWorkspace(workspaceId: string, at: number): Promise<void>;
}
