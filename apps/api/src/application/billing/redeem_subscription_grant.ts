import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type {
  SubscriptionGrantRepo,
  SubscriptionRepo,
} from "../../domain/billing/repo";
import type { User } from "../../domain/users/types";
import type {
  MemberRepo,
  WorkspaceRepo,
} from "../../domain/workspaces/repo";
import type { Clock } from "../../shared/clock";
import { COMPLIMENTARY_PERIOD_MS } from "../../shared/constants";
import { sha256Hex } from "../../shared/crypto";
import {
  AppError,
  conflict,
  forbidden,
  notFound,
} from "../../shared/errors";
import type { IdGenerator } from "../../shared/ids";
import type { WriteAudit } from "../audit/write_audit";

function gone(): AppError {
  return new AppError(
    "GONE",
    "This complimentary link is invalid or has already been used",
  );
}

export class RedeemSubscriptionGrant {
  constructor(
    private readonly grants: SubscriptionGrantRepo,
    private readonly subscriptions: SubscriptionRepo,
    private readonly workspaces: WorkspaceRepo,
    private readonly members: MemberRepo,
    private readonly audit: Pick<WriteAudit, "execute">,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: {
    tokenPlain: string;
    workspaceId: string;
    actor: User;
    ip?: string;
  }): Promise<{ workspaceId: string; subscriptionStatus: "ACTIVE" }> {
    const workspace = await this.workspaces.findById(input.workspaceId);
    if (workspace === null) throw notFound("Workspace");
    const membership = await this.members.find(workspace.id, input.actor.id);
    if (membership === null || membership.role !== "OWNER") {
      throw forbidden("Only the workspace owner can redeem this link");
    }

    const tokenHash = await sha256Hex(input.tokenPlain);
    const now = this.clock.now();
    const grant = await this.grants.findValidByHash(tokenHash, now);
    if (grant === null) throw gone();

    const current = await this.subscriptions.findByWorkspace(workspace.id);
    if (current?.status === "ACTIVE" || current?.status === "PAST_DUE") {
      throw conflict("This workspace already has an active subscription");
    }

    const consumed = await this.grants.consume(grant.id, workspace.id, now);
    if (!consumed) throw gone();

    await this.subscriptions.upsertByWorkspace({
      id: current?.id ?? this.ids.newId("sub"),
      workspaceId: workspace.id,
      provider: "internal",
      source: "grant",
      providerCustomerId: null,
      providerSubscriptionId: null,
      status: "ACTIVE",
      periodStart: now,
      periodEnd: now + COMPLIMENTARY_PERIOD_MS,
      cancelAtPeriodEnd: false,
      updatePaymentUrl: null,
      cancelUrl: null,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    });
    await this.audit.execute({
      workspaceId: workspace.id,
      actorUserId: input.actor.id,
      action: AUDIT_ACTIONS.billingGrantRedeemed,
      resourceType: "subscription_grant",
      resourceId: grant.id,
      metadata: { grantId: grant.id },
      ip: input.ip,
    });
    return { workspaceId: workspace.id, subscriptionStatus: "ACTIVE" };
  }
}
