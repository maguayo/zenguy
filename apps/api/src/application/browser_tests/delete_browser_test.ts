import type { WriteAudit } from "../audit/write_audit";
import { ensureActiveSubscription } from "../billing/ensure_active_subscription";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import type { BrowserTestRepo } from "../../domain/browser_tests/repo";
import type { StatusPageItemRepo } from "../../domain/status_pages/repo";
import { can } from "../../domain/workspaces/permissions";
import type { Role } from "../../domain/workspaces/types";
import type { User } from "../../domain/users/types";
import type { Clock } from "../../shared/clock";
import { forbidden, notFound } from "../../shared/errors";
import type { IncidentCloserOnDelete } from "./incident_closer";

export class DeleteBrowserTest {
  constructor(
    private readonly tests: BrowserTestRepo,
    private readonly subscriptions: SubscriptionRepo,
    private readonly incidents: IncidentCloserOnDelete,
    private readonly statusPageItems: Pick<
      StatusPageItemRepo,
      "removeForResource"
    >,
    private readonly audit: Pick<WriteAudit, "execute">,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    workspaceId: string;
    testId: string;
    actor: User;
    actorRole: Role;
    ip?: string;
  }): Promise<void> {
    if (!can(input.actorRole, "tests.manage")) throw forbidden();
    await ensureActiveSubscription(
      this.subscriptions,
      input.workspaceId,
      this.clock.now(),
    );
    const test = await this.tests.findById(input.workspaceId, input.testId);
    if (test === null) throw notFound("Browser test");
    const now = this.clock.now();
    await this.tests.softDelete(test.id, now);
    await this.incidents.closeForTest({
      workspaceId: input.workspaceId,
      testId: test.id,
      at: now,
    });
    await this.statusPageItems.removeForResource({ browserTestId: test.id });
    await this.audit.execute({
      workspaceId: input.workspaceId,
      actorUserId: input.actor.id,
      action: AUDIT_ACTIONS.testDeleted,
      resourceType: "browser_test",
      resourceId: test.id,
      metadata: { name: test.name },
      ip: input.ip,
    });
  }
}
