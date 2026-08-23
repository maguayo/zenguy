import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import type { MemberRepo, WorkspaceRepo } from "../../domain/workspaces/repo";
import { uniqueSlug } from "../../domain/workspaces/slug";
import type { User } from "../../domain/users/types";
import type { EnsureDefaultEmailChannel } from "../alerts/ensure_default_email_channel";
import type { EnsureDefaultPushChannel } from "../push/ensure_default_push_channel";
import type { WriteAudit } from "../audit/write_audit";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/ids";
import { logEvent } from "../../shared/log";
import { AppError } from "../../shared/errors";
import { workspaceName, workspaceTimezone } from "./input";
import { workspaceOutput, type WorkspaceOutput } from "./list_my_workspaces";

export interface CreateWorkspaceDependencies {
  workspaces: WorkspaceRepo;
  members: MemberRepo;
  subscriptions: SubscriptionRepo;
  defaultEmailChannel: Pick<EnsureDefaultEmailChannel, "execute">;
  defaultPushChannel: Pick<EnsureDefaultPushChannel, "execute">;
  audit: Pick<WriteAudit, "execute">;
  clock: Clock;
  ids: IdGenerator;
}

export class CreateWorkspace {
  constructor(private readonly dependencies: CreateWorkspaceDependencies) {}

  async execute(input: {
    name: string;
    timezone: string;
    actor: User;
    ip?: string;
  }): Promise<WorkspaceOutput> {
    const name = workspaceName(input.name);
    const timezone = workspaceTimezone(input.timezone);
    const now = this.dependencies.clock.now();
    const workspace = {
      id: this.dependencies.ids.newId("ws"),
      name,
      slug: await uniqueSlug(this.dependencies.workspaces, name),
      timezone,
      ownerUserId: input.actor.id,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    try {
      await this.dependencies.workspaces.insert(workspace);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("ZENGUY_OWNED_WORKSPACE_CAP")
      ) {
        throw new AppError(
          "RATE_LIMITED",
          "The workspace ownership limit has been reached",
        );
      }
      throw error;
    }
    await this.dependencies.members.insert({
      id: this.dependencies.ids.newId("mem"),
      workspaceId: workspace.id,
      userId: input.actor.id,
      role: "OWNER",
      invitedBy: null,
      joinedAt: now,
    });
    await this.dependencies.subscriptions.upsertByWorkspace({
      id: this.dependencies.ids.newId("sub"),
      workspaceId: workspace.id,
      provider: "internal",
      source: "free",
      providerCustomerId: null,
      providerSubscriptionId: null,
      status: "ACTIVE",
      periodStart: null,
      periodEnd: null,
      cancelAtPeriodEnd: false,
      updatePaymentUrl: null,
      cancelUrl: null,
      createdAt: now,
      updatedAt: now,
    });
    // Every workspace starts with a free email channel to the owner so the
    // first test or monitor alerts someone. Failing here must not undo the
    // workspace; the hourly backfill retries.
    try {
      await this.dependencies.defaultEmailChannel.execute({
        workspaceId: workspace.id,
        ownerUserId: input.actor.id,
        ownerEmail: input.actor.email,
      });
    } catch {
      logEvent("default_email_channel_failed", { workspaceId: workspace.id });
    }
    // Mobile push is also a free default from day one. It can have zero reach
    // until a member registers a device, but tests and monitors may safely
    // preselect it in the meantime.
    try {
      await this.dependencies.defaultPushChannel.execute({
        workspaceId: workspace.id,
      });
    } catch {
      logEvent("default_push_channel_failed", { workspaceId: workspace.id });
    }
    await this.dependencies.audit.execute({
      workspaceId: workspace.id,
      actorUserId: input.actor.id,
      action: AUDIT_ACTIONS.workspaceCreated,
      resourceType: "workspace",
      resourceId: workspace.id,
      metadata: { name: workspace.name },
      ip: input.ip,
    });
    return workspaceOutput(workspace, "OWNER", "ACTIVE");
  }
}
