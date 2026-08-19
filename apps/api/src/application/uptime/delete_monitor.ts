import type { WriteAudit } from "../audit/write_audit";
import { ensureActiveSubscription } from "../billing/ensure_active_subscription";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import type { IncidentEventRepo, IncidentRepo } from "../../domain/incidents/repo";
import type { MonitorRepo } from "../../domain/uptime/repo";
import type { User } from "../../domain/users/types";
import { can } from "../../domain/workspaces/permissions";
import type { Role } from "../../domain/workspaces/types";
import type { Clock } from "../../shared/clock";
import { forbidden, notFound } from "../../shared/errors";
import type { IdGenerator } from "../../shared/ids";

export class DeleteMonitor {
  constructor(
    private readonly monitors: MonitorRepo,
    private readonly incidents: IncidentRepo,
    private readonly events: IncidentEventRepo,
    private readonly subscriptions: SubscriptionRepo,
    private readonly audit: Pick<WriteAudit, "execute">,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: {
    workspaceId: string;
    monitorId: string;
    actor: User;
    actorRole: Role;
    ip?: string;
  }): Promise<void> {
    if (!can(input.actorRole, "uptime.manage")) throw forbidden();
    await ensureActiveSubscription(this.subscriptions, input.workspaceId);
    const monitor = await this.monitors.findById(
      input.workspaceId,
      input.monitorId,
    );
    if (monitor === null) throw notFound("Uptime monitor");
    const now = this.clock.now();
    await this.monitors.softDelete(monitor.id, now);
    const incident = await this.incidents.findOpenForMonitor(monitor.id);
    if (incident !== null && incident.workspaceId === input.workspaceId) {
      await this.incidents.resolve(incident.id, now, {});
      await this.events.insert({
        id: this.ids.newId("evt"),
        incidentId: incident.id,
        type: "MONITOR_DELETED",
        sourceId: monitor.id,
        message: `Uptime monitor ${monitor.id} deleted`,
        metadataJson: null,
        createdAt: now,
      });
    }
    await this.audit.execute({
      workspaceId: input.workspaceId,
      actorUserId: input.actor.id,
      action: AUDIT_ACTIONS.monitorDeleted,
      resourceType: "uptime_monitor",
      resourceId: monitor.id,
      metadata: { name: monitor.name },
      ip: input.ip,
    });
  }
}
