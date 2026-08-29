import type { WriteAudit } from "../audit/write_audit";
import { ensureActiveSubscription } from "../billing/ensure_active_subscription";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import type { StatusPageRepo } from "../../domain/status_pages/repo";
import { throwIfSlugTaken } from "../../domain/status_pages/rules";
import type { StatusPage } from "../../domain/status_pages/types";
import type { User } from "../../domain/users/types";
import { can } from "../../domain/workspaces/permissions";
import type { Role } from "../../domain/workspaces/types";
import type { Clock } from "../../shared/clock";
import { forbidden, throwIfCollectionCap } from "../../shared/errors";
import type { IdGenerator } from "../../shared/ids";
import { parseStatusPageConfig } from "./input";

export class CreateStatusPage {
  constructor(
    private readonly pages: StatusPageRepo,
    private readonly subscriptions: SubscriptionRepo,
    private readonly audit: Pick<WriteAudit, "execute">,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: {
    workspaceId: string;
    actor: User;
    actorRole: Role;
    config: unknown;
    ip?: string;
  }): Promise<StatusPage> {
    if (!can(input.actorRole, "status_pages.manage")) throw forbidden();
    await ensureActiveSubscription(
      this.subscriptions,
      input.workspaceId,
      this.clock.now(),
    );
    const config = parseStatusPageConfig(input.config);
    const now = this.clock.now();
    const page: StatusPage = {
      id: this.ids.newId("sp"),
      workspaceId: input.workspaceId,
      slug: config.slug,
      title: config.title,
      description: config.description ?? null,
      accentColor: config.accentColor ?? null,
      theme: config.theme,
      publishedAt: null,
      createdBy: input.actor.id,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    try {
      await this.pages.insert(page);
    } catch (error) {
      throwIfSlugTaken(error);
      throwIfCollectionCap(error);
      throw error;
    }
    await this.audit.execute({
      workspaceId: input.workspaceId,
      actorUserId: input.actor.id,
      action: AUDIT_ACTIONS.statusPageCreated,
      resourceType: "status_page",
      resourceId: page.id,
      metadata: { title: page.title, slug: page.slug },
      ip: input.ip,
    });
    return page;
  }
}
