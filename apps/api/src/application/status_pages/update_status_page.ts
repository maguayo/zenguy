import type { WriteAudit } from "../audit/write_audit";
import { ensureActiveSubscription } from "../billing/ensure_active_subscription";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import type {
  StatusPageRepo,
  StatusPageUpdateFields,
} from "../../domain/status_pages/repo";
import { throwIfSlugTaken } from "../../domain/status_pages/rules";
import type { StatusPage } from "../../domain/status_pages/types";
import type { User } from "../../domain/users/types";
import { can } from "../../domain/workspaces/permissions";
import type { Role } from "../../domain/workspaces/types";
import type { Clock } from "../../shared/clock";
import { forbidden, notFound } from "../../shared/errors";
import { parseStatusPageUpdate } from "./input";

export class UpdateStatusPage {
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
    config: unknown;
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
    const config = parseStatusPageUpdate(input.config);
    const changes: StatusPageUpdateFields = {
      ...(config.title === undefined ? {} : { title: config.title }),
      ...(config.slug === undefined ? {} : { slug: config.slug }),
      ...(config.description === undefined
        ? {}
        : { description: config.description ?? null }),
      ...(config.accentColor === undefined
        ? {}
        : { accentColor: config.accentColor ?? null }),
      ...(config.theme === undefined ? {} : { theme: config.theme }),
    };
    const now = this.clock.now();
    try {
      await this.pages.update(page.id, changes, now);
    } catch (error) {
      throwIfSlugTaken(error);
      throw error;
    }
    await this.audit.execute({
      workspaceId: input.workspaceId,
      actorUserId: input.actor.id,
      action: AUDIT_ACTIONS.statusPageUpdated,
      resourceType: "status_page",
      resourceId: page.id,
      metadata: { changed: Object.keys(changes).join(",") },
      ip: input.ip,
    });
    const updated = await this.pages.findById(input.workspaceId, page.id);
    if (updated === null) throw notFound("Status page");
    return updated;
  }
}
