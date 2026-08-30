import type { WriteAudit } from "../audit/write_audit";
import { ensureActiveSubscription } from "../billing/ensure_active_subscription";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import type { StatusPageRepo } from "../../domain/status_pages/repo";
import {
  customDomainStatusFromHostname,
  throwIfDomainTaken,
} from "../../domain/status_pages/rules";
import type { StatusPage } from "../../domain/status_pages/types";
import type { User } from "../../domain/users/types";
import { can } from "../../domain/workspaces/permissions";
import type { Role } from "../../domain/workspaces/types";
import type { CustomHostnameClient } from "../../infrastructure/cloudflare/custom_hostnames";
import type { Clock } from "../../shared/clock";
import { conflict, forbidden, notFound, unavailable } from "../../shared/errors";
import { logEvent } from "../../shared/log";
import { parseCustomDomain } from "./input";

export class SetCustomDomain {
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
    hostname: unknown;
    ip?: string;
  }): Promise<StatusPage> {
    if (!can(input.actorRole, "status_pages.manage")) throw forbidden();
    await ensureActiveSubscription(
      this.subscriptions,
      input.workspaceId,
      this.clock.now(),
    );
    const page = await this.pages.findById(input.workspaceId, input.pageId);
    if (page === null) throw notFound("Status page");
    if (this.customHostnames === null) {
      throw unavailable("Custom domains are not configured on this deployment");
    }
    const hostname = parseCustomDomain(input.hostname);
    if (page.customDomain !== null) {
      throw conflict("This page already has a custom domain — remove it first");
    }
    const taken = await this.pages.findByCustomDomain(hostname);
    if (taken !== null) {
      throw conflict("This domain is already connected to another status page");
    }

    const record = await this.customHostnames.create(hostname);
    const now = this.clock.now();
    try {
      await this.pages.setCustomDomain(
        page.id,
        {
          customDomain: hostname,
          customHostnameId: record.id,
          status: customDomainStatusFromHostname(record.status, record.sslStatus),
          checkedAt: now,
        },
        now,
      );
    } catch (error) {
      // Do not leak a Cloudflare-side hostname a competing writer just won.
      await this.customHostnames.remove(record.id).catch((cleanupError) => {
        logEvent("custom_domain.cleanup_failed", {
          hostnameId: record.id,
          error: String(cleanupError),
        });
      });
      throwIfDomainTaken(error);
      throw error;
    }
    await this.audit.execute({
      workspaceId: input.workspaceId,
      actorUserId: input.actor.id,
      action: AUDIT_ACTIONS.statusPageUpdated,
      resourceType: "status_page",
      resourceId: page.id,
      metadata: { changed: "customDomain", domain: hostname },
      ip: input.ip,
    });
    const updated = await this.pages.findById(input.workspaceId, page.id);
    if (updated === null) throw notFound("Status page");
    return updated;
  }
}
