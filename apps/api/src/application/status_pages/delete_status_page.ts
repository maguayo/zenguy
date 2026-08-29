import type { WriteAudit } from "../audit/write_audit";
import { ensureActiveSubscription } from "../billing/ensure_active_subscription";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import type { StatusPageRepo } from "../../domain/status_pages/repo";
import type { User } from "../../domain/users/types";
import { can } from "../../domain/workspaces/permissions";
import type { Role } from "../../domain/workspaces/types";
import type { Clock } from "../../shared/clock";
import { forbidden, notFound } from "../../shared/errors";

export class DeleteStatusPage {
  constructor(
    private readonly pages: StatusPageRepo,
    private readonly subscriptions: SubscriptionRepo,
    private readonly audit: Pick<WriteAudit, "execute">,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    workspaceId: string;
    actor: User;
    actorRole: Role;
    pageId: string;
    ip?: string;
  }): Promise<void> {
    if (!can(input.actorRole, "status_pages.manage")) throw forbidden();
    await ensureActiveSubscription(
      this.subscriptions,
      input.workspaceId,
      this.clock.now(),
    );
    const page = await this.pages.findById(input.workspaceId, input.pageId);
    if (page === null) throw notFound("Status page");
    await this.pages.softDelete(page.id, this.clock.now());
    await this.audit.execute({
      workspaceId: input.workspaceId,
      actorUserId: input.actor.id,
      action: AUDIT_ACTIONS.statusPageDeleted,
      resourceType: "status_page",
      resourceId: page.id,
      metadata: { title: page.title, slug: page.slug },
      ip: input.ip,
    });
  }
}
