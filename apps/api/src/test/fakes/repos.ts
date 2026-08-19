import type {
  EmailTokenRepo,
  RefreshTokenRepo,
  UserRepo,
} from "../../domain/users/repo";
import type {
  EmailToken,
  RefreshToken,
  User,
} from "../../domain/users/types";
import type {
  InvitationRepo,
  MemberRepo,
  WorkspaceMemberWithUser,
  WorkspaceRepo,
  WorkspaceUpdate,
} from "../../domain/workspaces/repo";
import type {
  Role,
  Workspace,
  WorkspaceInvitation,
  WorkspaceMember,
} from "../../domain/workspaces/types";
import type { AuditRepo } from "../../domain/audit/repo";
import type { AuditEntry } from "../../domain/audit/types";
import type { Cursor } from "../../shared/pagination";

function clone<T extends object>(value: T): T {
  return { ...value };
}

export class FakeUserRepo implements UserRepo {
  readonly users = new Map<string, User>();

  async findByEmail(email: string): Promise<User | null> {
    const normalized = email.toLowerCase();
    for (const user of this.users.values()) {
      if (user.email.toLowerCase() === normalized) return clone(user);
    }
    return null;
  }

  async findById(id: string): Promise<User | null> {
    const user = this.users.get(id);
    return user === undefined ? null : clone(user);
  }

  async insert(user: User): Promise<void> {
    if (
      this.users.has(user.id) ||
      (await this.findByEmail(user.email)) !== null
    ) {
      throw new Error("user constraint violation");
    }
    this.users.set(user.id, clone(user));
  }

  async setEmailVerified(id: string, at: number): Promise<void> {
    const user = this.users.get(id);
    if (user !== undefined) {
      this.users.set(id, { ...user, emailVerifiedAt: at, updatedAt: at });
    }
  }

  async setPassword(
    id: string,
    passwordHash: string,
    at: number,
  ): Promise<void> {
    const user = this.users.get(id);
    if (user !== undefined) {
      this.users.set(id, { ...user, passwordHash, updatedAt: at });
    }
  }

  async updateName(id: string, name: string, at: number): Promise<void> {
    const user = this.users.get(id);
    if (user !== undefined) {
      this.users.set(id, { ...user, name, updatedAt: at });
    }
  }
}

export class FakeEmailTokenRepo implements EmailTokenRepo {
  readonly tokens = new Map<string, EmailToken>();

  async insert(token: EmailToken): Promise<void> {
    if (
      this.tokens.has(token.id) ||
      [...this.tokens.values()].some(
        (candidate) => candidate.tokenHash === token.tokenHash,
      )
    ) {
      throw new Error("email token constraint violation");
    }
    this.tokens.set(token.id, clone(token));
  }

  async findValidByHash(
    hash: string,
    type: EmailToken["type"],
    now: number,
  ): Promise<EmailToken | null> {
    for (const token of this.tokens.values()) {
      if (
        token.tokenHash === hash &&
        token.type === type &&
        token.usedAt === null &&
        token.expiresAt > now
      ) {
        return clone(token);
      }
    }
    return null;
  }

  async markUsed(id: string, at: number): Promise<void> {
    const token = this.tokens.get(id);
    if (token !== undefined) {
      this.tokens.set(id, { ...token, usedAt: at });
    }
  }

  async deleteAllForUser(
    userId: string,
    type: EmailToken["type"],
  ): Promise<void> {
    for (const [id, token] of this.tokens) {
      if (token.userId === userId && token.type === type) {
        this.tokens.delete(id);
      }
    }
  }
}

export class FakeRefreshTokenRepo implements RefreshTokenRepo {
  readonly tokens = new Map<string, RefreshToken>();

  async insert(token: RefreshToken): Promise<void> {
    if (
      this.tokens.has(token.id) ||
      [...this.tokens.values()].some(
        (candidate) => candidate.tokenHash === token.tokenHash,
      )
    ) {
      throw new Error("refresh token constraint violation");
    }
    this.tokens.set(token.id, clone(token));
  }

  async findByHash(hash: string): Promise<RefreshToken | null> {
    for (const token of this.tokens.values()) {
      if (token.tokenHash === hash) return clone(token);
    }
    return null;
  }

  async revoke(
    id: string,
    at: number,
    replacedById?: string,
  ): Promise<void> {
    const token = this.tokens.get(id);
    if (token !== undefined) {
      this.tokens.set(id, {
        ...token,
        revokedAt: at,
        replacedById: replacedById ?? null,
      });
    }
  }

  async revokeAllForUser(userId: string, at: number): Promise<void> {
    for (const [id, token] of this.tokens) {
      if (token.userId === userId && token.revokedAt === null) {
        this.tokens.set(id, { ...token, revokedAt: at });
      }
    }
  }

  async deleteExpired(before: number): Promise<number> {
    let deleted = 0;
    for (const [id, token] of this.tokens) {
      if (token.expiresAt <= before) {
        this.tokens.delete(id);
        deleted += 1;
      }
    }
    return deleted;
  }
}

export class FakeWorkspaceState {
  readonly workspaces = new Map<string, Workspace>();
  readonly members = new Map<string, WorkspaceMember>();
  readonly invitations = new Map<string, WorkspaceInvitation>();
}

export class FakeWorkspaceRepo implements WorkspaceRepo {
  readonly workspaces: Map<string, Workspace>;

  constructor(readonly state = new FakeWorkspaceState()) {
    this.workspaces = state.workspaces;
  }

  async insert(workspace: Workspace): Promise<void> {
    if (
      this.workspaces.has(workspace.id) ||
      [...this.workspaces.values()].some(
        (candidate) => candidate.slug === workspace.slug,
      )
    ) {
      throw new Error("workspace constraint violation");
    }
    this.workspaces.set(workspace.id, clone(workspace));
  }

  async findById(
    id: string,
    includeDeleted = false,
  ): Promise<Workspace | null> {
    const workspace = this.workspaces.get(id);
    if (
      workspace === undefined ||
      (!includeDeleted && workspace.deletedAt !== null)
    ) {
      return null;
    }
    return clone(workspace);
  }

  async findBySlug(slug: string): Promise<Workspace | null> {
    for (const workspace of this.workspaces.values()) {
      if (workspace.slug === slug) return clone(workspace);
    }
    return null;
  }

  async update(
    id: string,
    changes: WorkspaceUpdate,
    at: number,
  ): Promise<void> {
    const workspace = this.workspaces.get(id);
    if (workspace !== undefined && workspace.deletedAt === null) {
      this.workspaces.set(id, { ...workspace, ...changes, updatedAt: at });
    }
  }

  async softDelete(id: string, at: number): Promise<void> {
    const workspace = this.workspaces.get(id);
    if (workspace !== undefined && workspace.deletedAt === null) {
      this.workspaces.set(id, { ...workspace, deletedAt: at, updatedAt: at });
    }
  }

  async transferOwnership(
    id: string,
    oldOwnerUserId: string,
    newOwnerUserId: string,
    at: number,
  ): Promise<void> {
    const workspace = this.workspaces.get(id);
    if (workspace === undefined || workspace.deletedAt !== null) return;
    const newOwner = [...this.state.members.entries()].find(
      ([, member]) =>
        member.workspaceId === id && member.userId === newOwnerUserId,
    );
    const oldOwner = [...this.state.members.entries()].find(
      ([, member]) =>
        member.workspaceId === id && member.userId === oldOwnerUserId,
    );
    if (newOwner === undefined || oldOwner === undefined) {
      throw new Error("ownership transfer constraint violation");
    }
    this.workspaces.set(id, {
      ...workspace,
      ownerUserId: newOwnerUserId,
      updatedAt: at,
    });
    this.state.members.set(newOwner[0], { ...newOwner[1], role: "OWNER" });
    this.state.members.set(oldOwner[0], { ...oldOwner[1], role: "ADMIN" });
  }

  async listForUser(
    userId: string,
  ): Promise<{ workspace: Workspace; role: Role }[]> {
    const result: { workspace: Workspace; role: Role }[] = [];
    for (const member of this.state.members.values()) {
      if (member.userId !== userId) continue;
      const workspace = this.workspaces.get(member.workspaceId);
      if (workspace !== undefined && workspace.deletedAt === null) {
        result.push({ workspace: clone(workspace), role: member.role });
      }
    }
    return result.sort(
      (left, right) =>
        right.workspace.createdAt - left.workspace.createdAt ||
        right.workspace.id.localeCompare(left.workspace.id),
    );
  }
}

export class FakeMemberRepo implements MemberRepo {
  readonly members: Map<string, WorkspaceMember>;

  constructor(
    readonly state = new FakeWorkspaceState(),
    private readonly users: UserRepo = new FakeUserRepo(),
  ) {
    this.members = state.members;
  }

  async insert(member: WorkspaceMember): Promise<void> {
    if (
      this.members.has(member.id) ||
      [...this.members.values()].some(
        (candidate) =>
          candidate.workspaceId === member.workspaceId &&
          candidate.userId === member.userId,
      )
    ) {
      throw new Error("workspace member constraint violation");
    }
    this.members.set(member.id, clone(member));
  }

  async find(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceMember | null> {
    for (const member of this.members.values()) {
      if (member.workspaceId === workspaceId && member.userId === userId) {
        return clone(member);
      }
    }
    return null;
  }

  async list(workspaceId: string): Promise<WorkspaceMemberWithUser[]> {
    const result: WorkspaceMemberWithUser[] = [];
    for (const member of this.members.values()) {
      if (member.workspaceId !== workspaceId) continue;
      const user = await this.users.findById(member.userId);
      if (user !== null) {
        result.push({
          ...clone(member),
          userName: user.name,
          userEmail: user.email,
        });
      }
    }
    return result.sort(
      (left, right) =>
        left.joinedAt - right.joinedAt || left.id.localeCompare(right.id),
    );
  }

  async updateRole(
    workspaceId: string,
    userId: string,
    role: Role,
  ): Promise<void> {
    for (const [id, member] of this.members) {
      if (member.workspaceId === workspaceId && member.userId === userId) {
        this.members.set(id, { ...member, role });
      }
    }
  }

  async remove(workspaceId: string, userId: string): Promise<void> {
    for (const [id, member] of this.members) {
      if (member.workspaceId === workspaceId && member.userId === userId) {
        this.members.delete(id);
      }
    }
  }
}

export class FakeInvitationRepo implements InvitationRepo {
  readonly invitations: Map<string, WorkspaceInvitation>;

  constructor(readonly state = new FakeWorkspaceState()) {
    this.invitations = state.invitations;
  }

  async insert(invitation: WorkspaceInvitation): Promise<void> {
    if (
      this.invitations.has(invitation.id) ||
      [...this.invitations.values()].some(
        (candidate) => candidate.tokenHash === invitation.tokenHash,
      )
    ) {
      throw new Error("invitation constraint violation");
    }
    this.invitations.set(invitation.id, clone(invitation));
  }

  async findByHash(hash: string): Promise<WorkspaceInvitation | null> {
    for (const invitation of this.invitations.values()) {
      if (invitation.tokenHash === hash) return clone(invitation);
    }
    return null;
  }

  async findPending(workspaceId: string): Promise<WorkspaceInvitation[]> {
    return [...this.invitations.values()]
      .filter(
        (invitation) =>
          invitation.workspaceId === workspaceId &&
          invitation.acceptedAt === null &&
          invitation.revokedAt === null,
      )
      .sort(
        (left, right) =>
          right.createdAt - left.createdAt ||
          right.id.localeCompare(left.id),
      )
      .map(clone);
  }

  async findValidByHash(
    hash: string,
    now: number,
  ): Promise<WorkspaceInvitation | null> {
    for (const invitation of this.invitations.values()) {
      if (
        invitation.tokenHash === hash &&
        invitation.acceptedAt === null &&
        invitation.revokedAt === null &&
        invitation.expiresAt > now
      ) {
        return clone(invitation);
      }
    }
    return null;
  }

  async findPendingByEmail(
    workspaceId: string,
    email: string,
  ): Promise<WorkspaceInvitation | null> {
    const normalized = email.toLowerCase();
    const matches = [...this.invitations.values()]
      .filter(
        (invitation) =>
          invitation.workspaceId === workspaceId &&
          invitation.email.toLowerCase() === normalized &&
          invitation.acceptedAt === null &&
          invitation.revokedAt === null,
      )
      .sort(
        (left, right) =>
          right.createdAt - left.createdAt ||
          right.id.localeCompare(left.id),
      );
    return matches[0] === undefined ? null : clone(matches[0]);
  }

  async markAccepted(id: string, at: number): Promise<void> {
    const invitation = this.invitations.get(id);
    if (
      invitation !== undefined &&
      invitation.acceptedAt === null &&
      invitation.revokedAt === null
    ) {
      this.invitations.set(id, { ...invitation, acceptedAt: at });
    }
  }

  async revoke(id: string, at: number): Promise<void> {
    const invitation = this.invitations.get(id);
    if (
      invitation !== undefined &&
      invitation.acceptedAt === null &&
      invitation.revokedAt === null
    ) {
      this.invitations.set(id, { ...invitation, revokedAt: at });
    }
  }

  async revokeAllForWorkspace(workspaceId: string, at: number): Promise<void> {
    for (const [id, invitation] of this.invitations) {
      if (
        invitation.workspaceId === workspaceId &&
        invitation.acceptedAt === null &&
        invitation.revokedAt === null
      ) {
        this.invitations.set(id, { ...invitation, revokedAt: at });
      }
    }
  }
}

export class FakeAuditRepo implements AuditRepo {
  readonly entries = new Map<string, AuditEntry>();

  async insert(entry: AuditEntry): Promise<void> {
    if (this.entries.has(entry.id)) {
      throw new Error("audit constraint violation");
    }
    this.entries.set(entry.id, clone(entry));
  }

  async list(
    workspaceId: string,
    cursor: Cursor | null | undefined,
    limit: number,
  ): Promise<AuditEntry[]> {
    return [...this.entries.values()]
      .filter(
        (entry) =>
          entry.workspaceId === workspaceId &&
          (cursor === null ||
            cursor === undefined ||
            entry.createdAt < cursor.createdAt ||
            (entry.createdAt === cursor.createdAt && entry.id < cursor.id)),
      )
      .sort(
        (left, right) =>
          right.createdAt - left.createdAt || right.id.localeCompare(left.id),
      )
      .slice(0, limit)
      .map(clone);
  }
}
