import type { WriteAudit } from "../audit/write_audit";
import { ensureActiveSubscription } from "../billing/ensure_active_subscription";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import type { IncidentUpdateRepo } from "../../domain/status_pages/repo";
import type { User } from "../../domain/users/types";
import { can } from "../../domain/workspaces/permissions";
import type { Role } from "../../domain/workspaces/types";
import type { Clock } from "../../shared/clock";
import { forbidden, notFound } from "../../shared/errors";

export class DeleteIncidentUpdate {
  constructor(
    private readonly updates: IncidentUpdateRepo,
    private readonly subscriptions: SubscriptionRepo,
    private readonly audit: Pick<WriteAudit, "execute">,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    workspaceId: string;
    actor: User;
    actorRole: Role;
    incidentId: string;
    updateId: string;
    ip?: string;
  }): Promise<void> {
    if (!can(input.actorRole, "status_pages.manage")) throw forbidden();
    await ensureActiveSubscription(
      this.subscriptions,
      input.workspaceId,
      this.clock.now(),
    );
    const update = await this.updates.findById(
      input.workspaceId,
      input.updateId,
    );
    if (update === null || update.incidentId !== input.incidentId) {
      throw notFound("Incident update");
    }
    await this.updates.remove(update.id);
    await this.audit.execute({
      workspaceId: input.workspaceId,
      actorUserId: input.actor.id,
      action: AUDIT_ACTIONS.incidentUpdateDeleted,
      resourceType: "incident",
      resourceId: update.incidentId,
      metadata: { updateId: update.id },
      ip: input.ip,
    });
  }
}
