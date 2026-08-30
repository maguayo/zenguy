import type {
  LegalAcceptance,
  LegalAcceptanceRepo,
} from "../../domain/users/legal_acceptance";
import type {
  OAuthIdentity,
  OAuthIdentityRepo,
  OAuthProvider,
} from "../../domain/users/oauth_identity";
import type {
  EmailTokenRepo,
  RefreshTokenRepo,
  SessionRevocationReason,
  SessionSecurityRepo,
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
import type {
  ChannelRepo,
  ChannelUpdate,
  DeliveryDispatchClaim,
  DeliveryRepo,
  DeliveryUpdate,
} from "../../domain/channels/repo";
import type {
  ChannelType,
  IncidentNotificationDelivery,
  NotificationChannel,
  NotificationDelivery,
} from "../../domain/channels/types";
import type { SecretRepo } from "../../domain/secrets/repo";
import type {
  SecretMetaUpdate,
  WorkspaceSecret,
} from "../../domain/secrets/types";
import type {
  OverageReportRepo,
  PendingOveragePeriodRepo,
  SubscriptionGrantRepo,
  SubscriptionRepo,
  UsageEventRepo,
} from "../../domain/billing/repo";
import type {
  OverageReport,
  PendingOveragePeriod,
  Subscription,
  SubscriptionGrant,
  UsageEvent,
} from "../../domain/billing/types";
import type { ApiKeyRepo } from "../../domain/api_keys/repo";
import type { WorkspaceApiKey } from "../../domain/api_keys/types";

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

  async findByIds(ids: string[]): Promise<User[]> {
    return [...new Set(ids)]
      .map((id) => this.users.get(id))
      .filter((user): user is User => user !== undefined)
      .map(clone);
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

  async insertIfAbsent(user: User): Promise<boolean> {
    if (
      this.users.has(user.id) ||
      (await this.findByEmail(user.email)) !== null
    ) {
      return false;
    }
    this.users.set(user.id, clone(user));
    return true;
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

  async rehashPasswordIfUnchanged(
    id: string,
    expectedPasswordHash: string,
    replacementPasswordHash: string,
    at: number,
  ): Promise<boolean> {
    const user = this.users.get(id);
    if (user === undefined || user.passwordHash !== expectedPasswordHash) {
      return false;
    }
    this.users.set(id, {
      ...user,
      passwordHash: replacementPasswordHash,
      updatedAt: at,
    });
    return true;
  }

  async updateName(id: string, name: string, at: number): Promise<void> {
    const user = this.users.get(id);
    if (user !== undefined) {
      this.users.set(id, { ...user, name, updatedAt: at });
    }
  }
}

export class FakeLegalAcceptanceRepo implements LegalAcceptanceRepo {
  readonly rows = new Map<string, LegalAcceptance>();

  async insert(row: LegalAcceptance): Promise<void> {
    if (this.rows.has(row.userId)) {
      throw new Error("legal acceptance constraint violation");
    }
    this.rows.set(row.userId, { ...row });
  }
}

export class FakeOAuthIdentityRepo implements OAuthIdentityRepo {
  readonly identities = new Map<string, OAuthIdentity>();

  private key(provider: OAuthProvider, subject: string): string {
    return `${provider}:${subject}`;
  }

  async findByProviderSubject(
    provider: OAuthProvider,
    subject: string,
  ): Promise<OAuthIdentity | null> {
    const identity = this.identities.get(this.key(provider, subject));
    return identity === undefined ? null : clone(identity);
  }

  async insertIfAbsent(identity: OAuthIdentity): Promise<boolean> {
    const key = this.key(identity.provider, identity.subject);
    if (
      this.identities.has(key) ||
      [...this.identities.values()].some(
        (candidate) =>
          candidate.provider === identity.provider &&
          candidate.userId === identity.userId,
      )
    ) {
      return false;
    }
    this.identities.set(key, clone(identity));
    return true;
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

  async consumeValidByHash(
    hash: string,
    type: EmailToken["type"],
    now: number,
  ): Promise<EmailToken | null> {
    const token = await this.findValidByHash(hash, type, now);
    if (token === null) return null;
    const current = this.tokens.get(token.id);
    if (current === undefined || current.usedAt !== null) return null;
    this.tokens.set(token.id, { ...current, usedAt: now });
    return clone(token);
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

  async rotate(
    currentId: string,
    replacement: RefreshToken,
    at: number,
  ): Promise<boolean> {
    const current = this.tokens.get(currentId);
    if (
      current === undefined ||
      current.userId !== replacement.userId ||
      current.revokedAt !== null ||
      current.expiresAt <= at ||
      this.tokens.has(replacement.id) ||
      [...this.tokens.values()].some(
        (candidate) => candidate.tokenHash === replacement.tokenHash,
      )
    ) {
      return false;
    }
    this.tokens.set(current.id, {
      ...current,
      revokedAt: at,
      replacedById: replacement.id,
    });
    this.tokens.set(replacement.id, clone(replacement));
    return true;
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

export class FakeSessionSecurityRepo implements SessionSecurityRepo {
  readonly revocations: {
    userId: string;
    at: number;
    reason: SessionRevocationReason;
  }[] = [];
  readonly revokedAdminUsers = new Set<string>();
  readonly disabledPushUsers = new Set<string>();

  constructor(
    private readonly users: FakeUserRepo,
    private readonly refreshTokens: FakeRefreshTokenRepo,
  ) {}

  private async revoke(
    userId: string,
    at: number,
    reason: SessionRevocationReason,
  ): Promise<void> {
    const user = this.users.users.get(userId);
    if (user !== undefined) {
      this.users.users.set(userId, {
        ...user,
        authVersion: user.authVersion + 1,
        updatedAt: at,
      });
    }
    for (const [id, token] of this.refreshTokens.tokens) {
      if (token.userId === userId) {
        this.refreshTokens.tokens.set(id, {
          ...token,
          tokenHash: `invalidated:${id}:${at}`,
          revokedAt: token.revokedAt ?? at,
        });
      }
    }
    this.revokedAdminUsers.add(userId);
    this.disabledPushUsers.add(userId);
    this.revocations.push({ userId, at, reason });
  }

  async revokeAllForUser(
    userId: string,
    at: number,
    reason: SessionRevocationReason,
  ): Promise<void> {
    await this.revoke(userId, at, reason);
  }

  async resetPasswordAndRevokeAll(
    userId: string,
    passwordHash: string,
    at: number,
  ): Promise<void> {
    const user = this.users.users.get(userId);
    if (user !== undefined) {
      this.users.users.set(userId, { ...user, passwordHash });
    }
    await this.revoke(userId, at, "password_reset");
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
  ): Promise<boolean> {
    const workspace = this.workspaces.get(id);
    if (
      workspace === undefined ||
      workspace.deletedAt !== null ||
      workspace.ownerUserId !== oldOwnerUserId
    ) {
      return false;
    }
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
    return true;
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
    _at?: number,
  ): Promise<void> {
    for (const [id, member] of this.members) {
      if (member.workspaceId === workspaceId && member.userId === userId) {
        this.members.set(id, { ...member, role });
      }
    }
  }

  async remove(
    workspaceId: string,
    userId: string,
    _at?: number,
  ): Promise<void> {
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

  async acceptByHash(input: {
    hash: string;
    email: string;
    userId: string;
    memberId: string;
    now: number;
  }): Promise<WorkspaceInvitation | null> {
    const invitation = await this.findValidByHash(input.hash, input.now);
    if (
      invitation === null ||
      invitation.email.toLowerCase() !== input.email.toLowerCase()
    ) {
      return null;
    }
    const inviter = [...this.state.members.values()].find(
      (member) =>
        member.workspaceId === invitation.workspaceId &&
        member.userId === invitation.invitedBy,
    );
    const authorized =
      inviter?.role === "OWNER" ||
      (inviter?.role === "ADMIN" && invitation.role === "MEMBER");
    if (!authorized) return null;

    const existing = [...this.state.members.values()].find(
      (member) =>
        member.workspaceId === invitation.workspaceId &&
        member.userId === input.userId,
    );
    if (existing === undefined) {
      this.state.members.set(input.memberId, {
        id: input.memberId,
        workspaceId: invitation.workspaceId,
        userId: input.userId,
        role: invitation.role,
        invitedBy: invitation.invitedBy,
        joinedAt: input.now,
      });
    }
    this.invitations.set(invitation.id, {
      ...invitation,
      acceptedAt: input.now,
    });
    return clone(invitation);
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

  async revoke(id: string, at: number): Promise<boolean> {
    const invitation = this.invitations.get(id);
    if (
      invitation !== undefined &&
      invitation.acceptedAt === null &&
      invitation.revokedAt === null
    ) {
      this.invitations.set(id, { ...invitation, revokedAt: at });
      return true;
    }
    return false;
  }

  async revokeUnauthorizedByInviter(
    workspaceId: string,
    inviterUserId: string,
    currentRole: Role | null,
    at: number,
  ): Promise<number> {
    if (currentRole === "OWNER") return 0;
    let revoked = 0;
    for (const [id, invitation] of this.invitations) {
      const shouldRevoke =
        invitation.workspaceId === workspaceId &&
        invitation.invitedBy === inviterUserId &&
        invitation.acceptedAt === null &&
        invitation.revokedAt === null &&
        (currentRole !== "ADMIN" || invitation.role === "ADMIN");
      if (shouldRevoke) {
        this.invitations.set(id, { ...invitation, revokedAt: at });
        revoked += 1;
      }
    }
    return revoked;
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

export class FakeSubscriptionRepo implements SubscriptionRepo {
  readonly subscriptions = new Map<string, Subscription>();

  async upsertByWorkspace(subscription: Subscription): Promise<void> {
    const existing = this.subscriptions.get(subscription.workspaceId);
    if (
      existing !== undefined &&
      existing.providerSubscriptionId !== null &&
      subscription.providerSubscriptionId !== null &&
      existing.providerSubscriptionId !== subscription.providerSubscriptionId
    ) {
      throw new Error("Workspace already has a different provider subscription");
    }
    if (
      existing?.lastProviderEventAt !== null &&
      existing?.lastProviderEventAt !== undefined &&
      subscription.lastProviderEventAt !== null &&
      subscription.lastProviderEventAt !== undefined &&
      subscription.lastProviderEventAt < existing.lastProviderEventAt
    ) {
      return;
    }
    const updated: Subscription = {
      ...clone(subscription),
      id: existing?.id ?? subscription.id,
      createdAt: existing?.createdAt ?? subscription.createdAt,
    };
    if (
      (subscription.lastProviderEventAt === null ||
        subscription.lastProviderEventAt === undefined) &&
      existing?.lastProviderEventAt !== null &&
      existing?.lastProviderEventAt !== undefined
    ) {
      updated.lastProviderEventAt = existing.lastProviderEventAt;
    }
    this.subscriptions.set(subscription.workspaceId, updated);
  }

  async findByWorkspace(workspaceId: string): Promise<Subscription | null> {
    const subscription = this.subscriptions.get(workspaceId);
    return subscription === undefined ? null : clone(subscription);
  }

  async findByProviderSubscriptionId(
    id: string,
  ): Promise<Subscription | null> {
    for (const subscription of this.subscriptions.values()) {
      if (subscription.providerSubscriptionId === id) {
        return clone(subscription);
      }
    }
    return null;
  }

  async listPeriodEnded(
    before: number,
    limit: number,
    after?: { periodEnd: number; id: string },
  ): Promise<Subscription[]> {
    return [...this.subscriptions.values()]
      .filter(
        (subscription) =>
          subscription.periodEnd !== null &&
          subscription.periodEnd <= before &&
          (after === undefined ||
            subscription.periodEnd > after.periodEnd ||
            (subscription.periodEnd === after.periodEnd &&
              subscription.id > after.id)),
      )
      .sort(
        (left, right) =>
          (left.periodEnd ?? 0) - (right.periodEnd ?? 0) ||
          left.id.localeCompare(right.id),
      )
      .slice(0, limit)
      .map(clone);
  }
}

export class FakeUsageEventRepo implements UsageEventRepo {
  readonly events = new Map<string, UsageEvent>();

  async insertIfAbsent(
    event: UsageEvent,
  ): Promise<"inserted" | "duplicate"> {
    if (
      this.events.has(event.id) ||
      [...this.events.values()].some(
        (candidate) =>
          candidate.idempotencyKey === event.idempotencyKey ||
          candidate.testRunId === event.testRunId,
      )
    ) {
      return "duplicate";
    }
    this.events.set(event.id, clone(event));
    return "inserted";
  }

  async findByRunId(runId: string): Promise<UsageEvent | null> {
    for (const event of this.events.values()) {
      if (event.testRunId === runId) return clone(event);
    }
    return null;
  }

  async reverseByRunId(runId: string, at: number): Promise<void> {
    for (const [id, event] of this.events) {
      if (event.testRunId === runId && event.reversedAt === null) {
        this.events.set(id, { ...event, reversedAt: at });
      }
    }
  }

  async countBillable(
    workspaceId: string,
    fromMs: number,
    toMs: number,
  ): Promise<number> {
    let total = 0;
    for (const event of this.events.values()) {
      if (
        event.workspaceId === workspaceId &&
        event.billable &&
        event.reversedAt === null &&
        event.occurredAt >= fromMs &&
        event.occurredAt < toMs
      ) {
        total += event.quantity;
      }
    }
    return total;
  }
}

export class FakeOverageReportRepo implements OverageReportRepo {
  readonly reports = new Map<string, OverageReport>();

  async insertIfAbsent(
    report: OverageReport,
  ): Promise<"inserted" | "duplicate"> {
    if (
      this.reports.has(report.id) ||
      [...this.reports.values()].some(
        (candidate) =>
          candidate.workspaceId === report.workspaceId &&
          candidate.periodStart === report.periodStart,
      )
    ) {
      return "duplicate";
    }
    this.reports.set(report.id, clone(report));
    return "inserted";
  }

  async findFor(
    workspaceId: string,
    periodStart: number,
  ): Promise<OverageReport | null> {
    const report = [...this.reports.values()].find(
      (report) =>
        report.workspaceId === workspaceId &&
        report.periodStart === periodStart,
    );
    return report === undefined ? null : clone(report);
  }

  async beginAttempt(
    id: string,
    at: number,
  ): Promise<boolean> {
    const report = this.reports.get(id);
    if (report === undefined) return false;
    if (report.state !== "PENDING" || report.attemptStartedAt !== null) {
      return false;
    }
    this.reports.set(id, {
      ...report,
      state: "AMBIGUOUS",
      attemptStartedAt: at,
    });
    return true;
  }

  async markCompleted(
    id: string,
    transactionId: string | null,
    at: number,
  ): Promise<void> {
    const report = this.reports.get(id);
    if (report === undefined) return;
    this.reports.set(id, {
      ...report,
      state: "COMPLETED",
      paddleTransactionId: transactionId,
      completedAt: at,
    });
  }
}

export class FakePendingOveragePeriodRepo implements PendingOveragePeriodRepo {
  readonly periods = new Map<string, PendingOveragePeriod>();

  private key(workspaceId: string, periodStart: number): string {
    return JSON.stringify([workspaceId, periodStart]);
  }

  async insertIfAbsent(
    period: PendingOveragePeriod,
  ): Promise<"inserted" | "duplicate"> {
    const key = this.key(period.workspaceId, period.periodStart);
    if (this.periods.has(key)) return "duplicate";
    this.periods.set(key, clone(period));
    return "inserted";
  }

  async list(limit: number): Promise<PendingOveragePeriod[]> {
    return [...this.periods.values()]
      .sort(
        (left, right) =>
          left.createdAt - right.createdAt ||
          left.workspaceId.localeCompare(right.workspaceId) ||
          left.periodStart - right.periodStart,
      )
      .slice(0, limit)
      .map(clone);
  }

  async listReady(
    at: number,
    limit: number,
  ): Promise<PendingOveragePeriod[]> {
    return [...this.periods.values()]
      .filter((period) => period.nextAttemptAt <= at)
      .sort(
        (left, right) =>
          left.nextAttemptAt - right.nextAttemptAt ||
          left.workspaceId.localeCompare(right.workspaceId) ||
          left.periodStart - right.periodStart,
      )
      .slice(0, limit)
      .map(clone);
  }

  async rescheduleFor(
    workspaceId: string,
    periodStart: number,
    nextAttemptAt: number,
  ): Promise<void> {
    const key = this.key(workspaceId, periodStart);
    const period = this.periods.get(key);
    if (period === undefined) return;
    this.periods.set(key, {
      ...period,
      nextAttemptAt,
      attemptCount: period.attemptCount + 1,
    });
  }

  async deleteFor(workspaceId: string, periodStart: number): Promise<void> {
    this.periods.delete(this.key(workspaceId, periodStart));
  }
}

export class FakeSecretRepo implements SecretRepo {
  readonly secrets = new Map<string, WorkspaceSecret>();

  async insert(secret: WorkspaceSecret): Promise<void> {
    if (
      this.secrets.has(secret.id) ||
      [...this.secrets.values()].some(
        (candidate) =>
          candidate.workspaceId === secret.workspaceId &&
          candidate.key === secret.key,
      )
    ) {
      throw new Error("secret constraint violation");
    }
    this.secrets.set(secret.id, {
      ...clone(secret),
      allowedDomains: [...secret.allowedDomains],
    });
  }

  async findByKey(
    workspaceId: string,
    key: string,
  ): Promise<WorkspaceSecret | null> {
    for (const secret of this.secrets.values()) {
      if (secret.workspaceId === workspaceId && secret.key === key) {
        return { ...clone(secret), allowedDomains: [...secret.allowedDomains] };
      }
    }
    return null;
  }

  async findById(
    workspaceId: string,
    id: string,
  ): Promise<WorkspaceSecret | null> {
    const secret = this.secrets.get(id);
    return secret === undefined || secret.workspaceId !== workspaceId
      ? null
      : { ...clone(secret), allowedDomains: [...secret.allowedDomains] };
  }

  async list(workspaceId: string): Promise<WorkspaceSecret[]> {
    return [...this.secrets.values()]
      .filter((secret) => secret.workspaceId === workspaceId)
      .sort(
        (left, right) =>
          right.createdAt - left.createdAt || right.id.localeCompare(left.id),
      )
      .map((secret) => ({
        ...clone(secret),
        allowedDomains: [...secret.allowedDomains],
      }));
  }

  async listPage(
    workspaceId: string,
    cursor: Cursor | null | undefined,
    limit: number,
  ): Promise<WorkspaceSecret[]> {
    return (await this.list(workspaceId))
      .filter(
        (secret) =>
          cursor === null ||
          cursor === undefined ||
          secret.createdAt < cursor.createdAt ||
          (secret.createdAt === cursor.createdAt && secret.id < cursor.id),
      )
      .slice(0, limit);
  }

  async updateValue(
    id: string,
    encryptedValue: string,
    encryptionVersion: number,
    at: number,
  ): Promise<void> {
    const secret = this.secrets.get(id);
    if (secret !== undefined) {
      this.secrets.set(id, {
        ...secret,
        encryptedValue,
        encryptionVersion,
        updatedAt: at,
      });
    }
  }

  async updateMeta(
    id: string,
    changes: SecretMetaUpdate,
    at: number,
  ): Promise<void> {
    const secret = this.secrets.get(id);
    if (secret !== undefined) {
      this.secrets.set(id, {
        ...secret,
        ...(changes.allowedDomains === undefined
          ? {}
          : { allowedDomains: [...changes.allowedDomains] }),
        ...(changes.description === undefined
          ? {}
          : { description: changes.description }),
        updatedAt: at,
      });
    }
  }

  async delete(id: string): Promise<void> {
    this.secrets.delete(id);
  }

  async getManyByKeys(
    workspaceId: string,
    keys: string[],
  ): Promise<WorkspaceSecret[]> {
    const wanted = new Set(keys);
    return [...this.secrets.values()]
      .filter(
        (secret) =>
          secret.workspaceId === workspaceId && wanted.has(secret.key),
      )
      .sort((left, right) => left.key.localeCompare(right.key))
      .map((secret) => ({
        ...clone(secret),
        allowedDomains: [...secret.allowedDomains],
      }));
  }
}

export class FakeChannelRepo implements ChannelRepo {
  readonly channels = new Map<string, NotificationChannel>();

  async insert(channel: NotificationChannel): Promise<void> {
    if (this.channels.has(channel.id)) {
      throw new Error("channel constraint violation");
    }
    this.channels.set(channel.id, clone(channel));
  }

  async findById(
    workspaceId: string,
    id: string,
  ): Promise<NotificationChannel | null> {
    const channel = this.channels.get(id);
    return channel === undefined || channel.workspaceId !== workspaceId
      ? null
      : clone(channel);
  }

  async list(workspaceId: string): Promise<NotificationChannel[]> {
    return [...this.channels.values()]
      .filter((channel) => channel.workspaceId === workspaceId)
      .sort(
        (left, right) =>
          right.createdAt - left.createdAt || right.id.localeCompare(left.id),
      )
      .map(clone);
  }

  async listPage(
    workspaceId: string,
    cursor: Cursor | null | undefined,
    limit: number,
  ): Promise<NotificationChannel[]> {
    return (await this.list(workspaceId))
      .filter(
        (channel) =>
          cursor === null ||
          cursor === undefined ||
          channel.createdAt < cursor.createdAt ||
          (channel.createdAt === cursor.createdAt && channel.id < cursor.id),
      )
      .slice(0, limit);
  }

  async listByIds(
    workspaceId: string,
    ids: string[],
  ): Promise<NotificationChannel[]> {
    const wanted = new Set(ids);
    return (await this.list(workspaceId)).filter((channel) =>
      wanted.has(channel.id),
    );
  }

  async update(
    id: string,
    changes: ChannelUpdate,
    at: number,
  ): Promise<void> {
    const channel = this.channels.get(id);
    if (channel !== undefined) {
      this.channels.set(id, { ...channel, ...changes, updatedAt: at });
    }
  }

  async setLastDeliveryStatus(id: string, status: string): Promise<void> {
    const channel = this.channels.get(id);
    if (channel !== undefined) {
      this.channels.set(id, { ...channel, lastDeliveryStatus: status });
    }
  }

  async setVerified(id: string, at: number): Promise<void> {
    const channel = this.channels.get(id);
    if (channel !== undefined && channel.verifiedAt === null) {
      this.channels.set(id, { ...channel, verifiedAt: at });
    }
  }

  async delete(id: string): Promise<void> {
    this.channels.delete(id);
  }
}

export class FakeDeliveryRepo implements DeliveryRepo {
  readonly deliveries = new Map<string, NotificationDelivery>();
  readonly processingAt = new Map<string, number>();
  readonly dispatchTokens = new Map<string, string>();
  readonly incidentChannelDetails = new Map<
    string,
    { name: string; type: ChannelType }
  >();

  setIncidentChannelDetails(
    channelId: string,
    details: { name: string; type: ChannelType },
  ): void {
    this.incidentChannelDetails.set(channelId, clone(details));
  }

  async insert(delivery: NotificationDelivery): Promise<void> {
    if (this.deliveries.has(delivery.id)) {
      throw new Error("delivery constraint violation");
    }
    this.deliveries.set(delivery.id, {
      ...clone(delivery),
      dispatchState: delivery.dispatchState ?? "READY",
      providerIdempotencyKey:
        delivery.providerIdempotencyKey ?? delivery.id,
      dispatchGeneration: delivery.dispatchGeneration ?? 0,
    });
  }

  async findById(
    workspaceId: string,
    id: string,
  ): Promise<NotificationDelivery | null> {
    const delivery = this.deliveries.get(id);
    return delivery === undefined || delivery.workspaceId !== workspaceId
      ? null
      : clone(delivery);
  }

  async update(id: string, changes: DeliveryUpdate): Promise<void> {
    const delivery = this.deliveries.get(id);
    if (delivery !== undefined) {
      this.deliveries.set(id, {
        ...delivery,
        ...changes,
        dispatchState: changes.status === "PENDING" ? "READY" : "CONFIRMED",
      });
      this.processingAt.delete(id);
      this.dispatchTokens.delete(id);
    }
  }

  async beginDispatch(
    workspaceId: string,
    id: string,
    dispatchToken: string,
    claimedAt: number,
    staleBefore: number,
  ): Promise<DeliveryDispatchClaim | null> {
    const delivery = this.deliveries.get(id);
    const lease = this.processingAt.get(id);
    if (
      delivery === undefined ||
      delivery.workspaceId !== workspaceId ||
      delivery.status !== "PENDING" ||
      (delivery.dispatchState ?? "READY") !== "READY" ||
      (lease !== undefined && lease > staleBefore)
    ) {
      return null;
    }
    this.processingAt.set(id, claimedAt);
    this.dispatchTokens.set(id, dispatchToken);
    const claimed: NotificationDelivery = {
      ...delivery,
      attemptCount: delivery.attemptCount + 1,
      dispatchState: "DISPATCHING",
      providerIdempotencyKey: delivery.providerIdempotencyKey ?? delivery.id,
      dispatchGeneration: (delivery.dispatchGeneration ?? 0) + 1,
    };
    this.deliveries.set(id, claimed);
    return { delivery: clone(claimed), dispatchToken };
  }

  async finishDispatch(
    id: string,
    dispatchToken: string,
    changes: DeliveryUpdate,
  ): Promise<boolean> {
    const delivery = this.deliveries.get(id);
    if (
      delivery === undefined ||
      delivery.status !== "PENDING" ||
      delivery.dispatchState !== "DISPATCHING" ||
      this.dispatchTokens.get(id) !== dispatchToken
    ) {
      return false;
    }
    this.deliveries.set(id, {
      ...delivery,
      ...changes,
      dispatchState: changes.status === "PENDING" ? "READY" : "CONFIRMED",
    });
    this.processingAt.delete(id);
    this.dispatchTokens.delete(id);
    return true;
  }

  async markDispatchAmbiguous(
    id: string,
    dispatchToken: string,
    attemptCount: number,
    errorSanitized: string,
  ): Promise<NotificationDelivery | null> {
    const delivery = this.deliveries.get(id);
    if (
      delivery === undefined ||
      delivery.status !== "PENDING" ||
      delivery.dispatchState !== "DISPATCHING" ||
      this.dispatchTokens.get(id) !== dispatchToken
    ) {
      return null;
    }
    const ambiguous: NotificationDelivery = {
      ...delivery,
      dispatchState: "AMBIGUOUS",
      attemptCount,
      errorSanitized,
    };
    this.deliveries.set(id, ambiguous);
    this.processingAt.delete(id);
    this.dispatchTokens.delete(id);
    return clone(ambiguous);
  }

  async markStaleDispatchAmbiguous(
    workspaceId: string,
    id: string,
    staleBefore: number,
    errorSanitized: string,
  ): Promise<NotificationDelivery | null> {
    const delivery = this.deliveries.get(id);
    const lease = this.processingAt.get(id);
    if (
      delivery === undefined ||
      delivery.workspaceId !== workspaceId ||
      delivery.status !== "PENDING" ||
      delivery.dispatchState !== "DISPATCHING" ||
      lease === undefined ||
      lease > staleBefore
    ) {
      return null;
    }
    const ambiguous: NotificationDelivery = {
      ...delivery,
      dispatchState: "AMBIGUOUS",
      errorSanitized,
    };
    this.deliveries.set(id, ambiguous);
    this.processingAt.delete(id);
    this.dispatchTokens.delete(id);
    return clone(ambiguous);
  }

  async recordProviderAcceptance(
    id: string,
    providerIdempotencyKey: string,
    providerMessageId: string | null,
    sentAt: number,
  ): Promise<boolean> {
    const delivery = this.deliveries.get(id);
    if (
      delivery === undefined ||
      delivery.status !== "PENDING" ||
      delivery.dispatchState !== "AMBIGUOUS" ||
      delivery.providerIdempotencyKey !== providerIdempotencyKey
    ) {
      return false;
    }
    this.deliveries.set(id, {
      ...delivery,
      status: "SENT",
      dispatchState: "CONFIRMED",
      providerMessageId,
      errorSanitized: null,
      sentAt,
    });
    return true;
  }

  async listForChannel(
    channelId: string,
    cursor: Cursor | null | undefined,
    limit: number,
  ): Promise<NotificationDelivery[]> {
    return [...this.deliveries.values()]
      .filter(
        (delivery) =>
          delivery.notificationChannelId === channelId &&
          (cursor === null ||
            cursor === undefined ||
            delivery.createdAt < cursor.createdAt ||
            (delivery.createdAt === cursor.createdAt &&
              delivery.id < cursor.id)),
      )
      .sort(
        (left, right) =>
          right.createdAt - left.createdAt || right.id.localeCompare(left.id),
      )
      .slice(0, limit)
      .map(clone);
  }

  async listForIncident(incidentId: string): Promise<NotificationDelivery[]> {
    return [...this.deliveries.values()]
      .filter((delivery) => delivery.incidentId === incidentId)
      .sort(
        (left, right) =>
          left.createdAt - right.createdAt || left.id.localeCompare(right.id),
      )
      .map(clone);
  }

  async listForIncidentWithChannel(
    incidentId: string,
  ): Promise<IncidentNotificationDelivery[]> {
    return (await this.listForIncident(incidentId)).map((delivery) => {
      const channel = this.incidentChannelDetails.get(
        delivery.notificationChannelId,
      );
      return {
        ...delivery,
        channelName: channel?.name ?? "Deleted channel",
        channelType: channel?.type ?? null,
      };
    });
  }
}

export class FakeApiKeyRepo implements ApiKeyRepo {
  readonly apiKeys = new Map<string, WorkspaceApiKey>();

  async insert(apiKey: WorkspaceApiKey): Promise<void> {
    if (
      this.apiKeys.has(apiKey.id) ||
      [...this.apiKeys.values()].some(
        (candidate) => candidate.keyHash === apiKey.keyHash,
      )
    ) {
      throw new Error("api key constraint violation");
    }
    this.apiKeys.set(apiKey.id, clone(apiKey));
  }

  async findById(
    workspaceId: string,
    id: string,
  ): Promise<WorkspaceApiKey | null> {
    const apiKey = this.apiKeys.get(id);
    return apiKey === undefined || apiKey.workspaceId !== workspaceId
      ? null
      : clone(apiKey);
  }

  async findByHash(keyHash: string): Promise<WorkspaceApiKey | null> {
    for (const apiKey of this.apiKeys.values()) {
      if (apiKey.keyHash === keyHash) return clone(apiKey);
    }
    return null;
  }

  async list(workspaceId: string): Promise<WorkspaceApiKey[]> {
    return [...this.apiKeys.values()]
      .filter((apiKey) => apiKey.workspaceId === workspaceId)
      .sort(
        (left, right) =>
          right.createdAt - left.createdAt || right.id.localeCompare(left.id),
      )
      .map(clone);
  }

  async countActive(workspaceId: string, now: number): Promise<number> {
    return [...this.apiKeys.values()].filter(
      (apiKey) =>
        apiKey.workspaceId === workspaceId &&
        apiKey.revokedAt === null &&
        apiKey.expiresAt > now,
    ).length;
  }

  async revoke(id: string, at: number): Promise<void> {
    const apiKey = this.apiKeys.get(id);
    if (apiKey !== undefined && apiKey.revokedAt === null) {
      this.apiKeys.set(id, { ...apiKey, revokedAt: at });
    }
  }

  async revokeAllCreatedBy(
    workspaceId: string,
    creatorUserId: string,
    at: number,
  ): Promise<number> {
    let revoked = 0;
    for (const [id, apiKey] of this.apiKeys) {
      if (
        apiKey.workspaceId === workspaceId &&
        apiKey.createdBy === creatorUserId &&
        apiKey.revokedAt === null
      ) {
        this.apiKeys.set(id, { ...apiKey, revokedAt: at });
        revoked += 1;
      }
    }
    return revoked;
  }

  async touchLastUsed(id: string, at: number): Promise<void> {
    const apiKey = this.apiKeys.get(id);
    if (apiKey !== undefined) {
      this.apiKeys.set(id, { ...apiKey, lastUsedAt: at });
    }
  }
}

export class FakeSubscriptionGrantRepo implements SubscriptionGrantRepo {
  readonly grants = new Map<string, SubscriptionGrant>();

  async insert(grant: SubscriptionGrant): Promise<void> {
    if (this.grants.has(grant.id)) {
      throw new Error("grant constraint violation");
    }
    this.grants.set(grant.id, clone(grant));
  }

  async findByHash(hash: string): Promise<SubscriptionGrant | null> {
    for (const grant of this.grants.values()) {
      if (grant.tokenHash === hash) return clone(grant);
    }
    return null;
  }

  async findValidByHash(
    hash: string,
    now: number,
  ): Promise<SubscriptionGrant | null> {
    for (const grant of this.grants.values()) {
      if (
        grant.tokenHash === hash &&
        grant.redeemedAt === null &&
        grant.expiresAt > now
      ) {
        return clone(grant);
      }
    }
    return null;
  }

  async listByIssuer(userId: string): Promise<SubscriptionGrant[]> {
    return [...this.grants.values()]
      .filter((grant) => grant.issuedByUserId === userId)
      .sort(
        (left, right) =>
          right.createdAt - left.createdAt || right.id.localeCompare(left.id),
      )
      .map(clone);
  }

  async consume(
    id: string,
    workspaceId: string,
    at: number,
  ): Promise<boolean> {
    const grant = this.grants.get(id);
    if (
      grant === undefined ||
      grant.redeemedAt !== null ||
      grant.expiresAt <= at
    ) {
      return false;
    }
    this.grants.set(id, {
      ...grant,
      redeemedAt: at,
      redeemedWorkspaceId: workspaceId,
    });
    return true;
  }
}
