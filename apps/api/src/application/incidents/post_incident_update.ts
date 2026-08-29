import type { WriteAudit } from "../audit/write_audit";
import { ensureActiveSubscription } from "../billing/ensure_active_subscription";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import type { IncidentRepo } from "../../domain/incidents/repo";
import type { IncidentUpdateRepo } from "../../domain/status_pages/repo";
import type { IncidentUpdate } from "../../domain/status_pages/types";
import type { User } from "../../domain/users/types";
import { can } from "../../domain/workspaces/permissions";
import type { Role } from "../../domain/workspaces/types";
import type { Clock } from "../../shared/clock";
import { MAX_INCIDENT_UPDATE_LENGTH } from "../../shared/constants";
import { forbidden, notFound, validation } from "../../shared/errors";
import type { IdGenerator } from "../../shared/ids";

export class PostIncidentUpdate {
  constructor(
    private readonly incidents: Pick<IncidentRepo, "findById">,
    private readonly updates: IncidentUpdateRepo,
    private readonly subscriptions: SubscriptionRepo,
    private readonly audit: Pick<WriteAudit, "execute">,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: {
    workspaceId: string;
    actor: User;
    actorRole: Role;
    incidentId: string;
    message: string;
    ip?: string;
  }): Promise<IncidentUpdate> {
    if (!can(input.actorRole, "status_pages.manage")) throw forbidden();
    await ensureActiveSubscription(
      this.subscriptions,
      input.workspaceId,
      this.clock.now(),
    );
    const incident = await this.incidents.findById(
      input.workspaceId,
      input.incidentId,
    );
    if (incident === null) throw notFound("Incident");
    const message = input.message.trim();
    if (message.length === 0 || message.length > MAX_INCIDENT_UPDATE_LENGTH) {
      throw validation([
        {
          field: "message",
          message: `1-${MAX_INCIDENT_UPDATE_LENGTH} characters`,
        },
      ]);
    }
    const update: IncidentUpdate = {
      id: this.ids.newId("iu"),
      incidentId: incident.id,
      workspaceId: input.workspaceId,
      message,
      createdBy: input.actor.id,
      createdAt: this.clock.now(),
    };
    await this.updates.insert(update);
    await this.audit.execute({
      workspaceId: input.workspaceId,
      actorUserId: input.actor.id,
      action: AUDIT_ACTIONS.incidentUpdatePosted,
      resourceType: "incident",
      resourceId: incident.id,
      metadata: { updateId: update.id },
      ip: input.ip,
    });
    return update;
  }
}
