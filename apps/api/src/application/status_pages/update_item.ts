import type { WriteAudit } from "../audit/write_audit";
import { ensureActiveSubscription } from "../billing/ensure_active_subscription";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import type {
  StatusPageItemRepo,
  StatusPageRepo,
} from "../../domain/status_pages/repo";
import type { StatusPageItem } from "../../domain/status_pages/types";
import type { User } from "../../domain/users/types";
import { can } from "../../domain/workspaces/permissions";
import type { Role } from "../../domain/workspaces/types";
import type { Clock } from "../../shared/clock";
import { forbidden, notFound } from "../../shared/errors";
import { parseStatusPageItemUpdate } from "./input";

export class UpdateStatusPageItem {
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
    itemId: string;
    config: unknown;
    ip?: string;
  }): Promise<StatusPageItem> {
    if (!can(input.actorRole, "status_pages.manage")) throw forbidden();
    await ensureActiveSubscription(
      this.subscriptions,
      input.workspaceId,
      this.clock.now(),
    );
    const page = await this.pages.findById(input.workspaceId, input.pageId);
    if (page === null) throw notFound("Status page");
    const item = await this.items.findById(page.id, input.itemId);
    if (item === null) throw notFound("Status page item");
    const config = parseStatusPageItemUpdate(input.config);
    await this.items.update(item.id, {
      ...(config.displayName === undefined
        ? {}
        : { displayName: config.displayName }),
      ...(config.groupName === undefined
        ? {}
        : { groupName: config.groupName ?? null }),
    });
    await this.audit.execute({
      workspaceId: input.workspaceId,
      actorUserId: input.actor.id,
      action: AUDIT_ACTIONS.statusPageItemsChanged,
      resourceType: "status_page",
      resourceId: page.id,
      metadata: { op: "renamed", itemId: item.id },
      ip: input.ip,
    });
    const updated = await this.items.findById(page.id, item.id);
    if (updated === null) throw notFound("Status page item");
    return updated;
  }
}
