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
import type {
  ChannelRepo,
  ChannelUpdate,
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
  SubscriptionRepo,
  UsageEventRepo,
} from "../../domain/billing/repo";
import type {
  OverageReport,
  Subscription,
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

export class FakeSubscriptionRepo implements SubscriptionRepo {
  readonly subscriptions = new Map<string, Subscription>();

  async upsertByWorkspace(subscription: Subscription): Promise<void> {
    const existing = this.subscriptions.get(subscription.workspaceId);
    this.subscriptions.set(subscription.workspaceId, {
      ...clone(subscription),
      id: existing?.id ?? subscription.id,
      createdAt: existing?.createdAt ?? subscription.createdAt,
    });
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
  ): Promise<Subscription[]> {
    return [...this.subscriptions.values()]
      .filter(
        (subscription) =>
          subscription.periodEnd !== null &&
          subscription.periodEnd <= before,
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

  async existsFor(
    workspaceId: string,
    periodStart: number,
  ): Promise<boolean> {
    return [...this.reports.values()].some(
      (report) =>
        report.workspaceId === workspaceId &&
        report.periodStart === periodStart,
    );
  }

  async setPaddleTransactionId(
    id: string,
    transactionId: string | null,
  ): Promise<void> {
    const report = this.reports.get(id);
    if (report !== undefined) {
      this.reports.set(id, {
        ...report,
        paddleTransactionId: transactionId,
      });
    }
  }

  async deleteById(id: string): Promise<void> {
    this.reports.delete(id);
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

  async updateValue(
    id: string,
    encryptedValue: string,
    at: number,
  ): Promise<void> {
    const secret = this.secrets.get(id);
    if (secret !== undefined) {
      this.secrets.set(id, { ...secret, encryptedValue, updatedAt: at });
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
    this.deliveries.set(delivery.id, clone(delivery));
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
      this.deliveries.set(id, { ...delivery, ...changes });
    }
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

  async countActive(workspaceId: string): Promise<number> {
    return [...this.apiKeys.values()].filter(
      (apiKey) =>
        apiKey.workspaceId === workspaceId && apiKey.revokedAt === null,
    ).length;
  }

  async revoke(id: string, at: number): Promise<void> {
    const apiKey = this.apiKeys.get(id);
    if (apiKey !== undefined && apiKey.revokedAt === null) {
      this.apiKeys.set(id, { ...apiKey, revokedAt: at });
    }
  }

  async touchLastUsed(id: string, at: number): Promise<void> {
    const apiKey = this.apiKeys.get(id);
    if (apiKey !== undefined) {
      this.apiKeys.set(id, { ...apiKey, lastUsedAt: at });
    }
  }
}
