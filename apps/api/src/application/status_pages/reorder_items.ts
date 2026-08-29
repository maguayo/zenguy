import type { WriteAudit } from "../audit/write_audit";
import { ensureActiveSubscription } from "../billing/ensure_active_subscription";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import type {
  StatusPageItemRepo,
  StatusPageRepo,
} from "../../domain/status_pages/repo";
import type { User } from "../../domain/users/types";
import { can } from "../../domain/workspaces/permissions";
import type { Role } from "../../domain/workspaces/types";
import type { Clock } from "../../shared/clock";
import { forbidden, notFound, validation } from "../../shared/errors";

export class ReorderStatusPageItems {
  constructor(
    private readonly pages: StatusPageRepo,
    private readonly items: StatusPageItemRepo,
    private readonly subscriptions: SubscriptionRepo,
    private readonly audit: Pick<WriteAudit, "execute">,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    workspaceId: string;
    actor: User;
    actorRole: Role;
    pageId: string;
    itemIds: string[];
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
    const items = await this.items.listForPage(page.id);
    const current = new Set(items.map((item) => item.id));
    const provided = new Set(input.itemIds);
    if (
      provided.size !== input.itemIds.length ||
      current.size !== provided.size ||
      [...current].some((id) => !provided.has(id))
    ) {
      throw validation([
        {
          field: "itemIds",
          message: "itemIds must contain every item of the page exactly once",
        },
      ]);
    }
    await this.items.reorder(page.id, input.itemIds);
    await this.audit.execute({
      workspaceId: input.workspaceId,
      actorUserId: input.actor.id,
      action: AUDIT_ACTIONS.statusPageItemsChanged,
      resourceType: "status_page",
      resourceId: page.id,
      metadata: { op: "reordered" },
      ip: input.ip,
    });
  }
}
