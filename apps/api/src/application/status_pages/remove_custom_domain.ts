import type { WriteAudit } from "../audit/write_audit";
import { ensureActiveSubscription } from "../billing/ensure_active_subscription";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import type { StatusPageRepo } from "../../domain/status_pages/repo";
import type { User } from "../../domain/users/types";
import { can } from "../../domain/workspaces/permissions";
import type { Role } from "../../domain/workspaces/types";
import type { CustomHostnameClient } from "../../infrastructure/cloudflare/custom_hostnames";
import type { Clock } from "../../shared/clock";
import { forbidden, notFound } from "../../shared/errors";
import { logEvent } from "../../shared/log";

export class RemoveCustomDomain {
  constructor(
    private readonly pages: StatusPageRepo,
    private readonly subscriptions: SubscriptionRepo,
    private readonly customHostnames: CustomHostnameClient | null,
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
    if (page.customDomain === null) throw notFound("Custom domain");

    // Best-effort external cleanup: the local columns clear either way, so a
    // Cloudflare hiccup never wedges the page. Orphans go inert once DNS moves.
    if (this.customHostnames !== null && page.customHostnameId !== null) {
      await this.customHostnames.remove(page.customHostnameId).catch((error) => {
        logEvent("custom_domain.cleanup_failed", {
          hostnameId: page.customHostnameId,
          error: String(error),
        });
      });
    }
    await this.pages.clearCustomDomain(page.id, this.clock.now());
    await this.audit.execute({
      workspaceId: input.workspaceId,
      actorUserId: input.actor.id,
      action: AUDIT_ACTIONS.statusPageUpdated,
      resourceType: "status_page",
      resourceId: page.id,
      metadata: { changed: "customDomain", domain: page.customDomain, removed: true },
      ip: input.ip,
    });
  }
}
