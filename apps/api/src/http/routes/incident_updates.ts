import { Hono } from "hono";
import { z } from "zod";
import type { WriteAudit } from "../../application/audit/write_audit";
import { DeleteIncidentUpdate } from "../../application/incidents/delete_incident_update";
import { PostIncidentUpdate } from "../../application/incidents/post_incident_update";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import type { IncidentRepo } from "../../domain/incidents/repo";
import type { IncidentUpdateRepo } from "../../domain/status_pages/repo";
import type { UserRepo } from "../../domain/users/repo";
import type {
  MemberRepo,
  WorkspaceRepo,
} from "../../domain/workspaces/repo";
import type { Clock } from "../../shared/clock";
import type { AppConfig } from "../../shared/config";
import { MAX_INCIDENT_UPDATE_LENGTH } from "../../shared/constants";
import { notFound } from "../../shared/errors";
import type { IdGenerator } from "../../shared/ids";
import type { AppEnv } from "../env";
import { requireAuth, requireVerifiedEmail } from "../middleware/auth";
import { requireActiveSubscription } from "../middleware/require_subscription";
import { requireAction, withWorkspace } from "../middleware/workspace";
import { presentIncidentUpdate } from "../presenters/status_page";
import { zjson } from "../validate";

export interface IncidentUpdateRoutesDependencies {
  users: UserRepo;
  workspaces: WorkspaceRepo;
  members: MemberRepo;
  subscriptions: SubscriptionRepo;
  incidents: IncidentRepo;
  incidentUpdates: IncidentUpdateRepo;
  audit: Pick<WriteAudit, "execute">;
  clock: Clock;
  ids: IdGenerator;
  config: Pick<AppConfig, "jwtSecret">;
}

const postSchema = z.object({
  message: z.string().min(1).max(MAX_INCIDENT_UPDATE_LENGTH + 100),
});

function requestIp(context: {
  req: { header(name: string): string | undefined };
}): string | undefined {
  return context.req.header("CF-Connecting-IP");
}

export function incidentUpdateRoutes(
  dependencies: IncidentUpdateRoutesDependencies,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const auth = requireAuth(dependencies);
  const workspace = withWorkspace(dependencies);
  const active = requireActiveSubscription(
    dependencies.subscriptions,
    dependencies.clock,
  );
  const manage = requireAction("status_pages.manage");
  const postIncidentUpdate = new PostIncidentUpdate(
    dependencies.incidents,
    dependencies.incidentUpdates,
    dependencies.subscriptions,
    dependencies.audit,
    dependencies.clock,
    dependencies.ids,
  );
  const deleteIncidentUpdate = new DeleteIncidentUpdate(
    dependencies.incidentUpdates,
    dependencies.subscriptions,
    dependencies.audit,
    dependencies.clock,
  );

  app.get(
    "/:workspaceId/incidents/:incidentId/updates",
    auth,
    requireVerifiedEmail,
    workspace,
    async (context) => {
      const incident = await dependencies.incidents.findById(
        context.get("workspace").id,
        context.req.param("incidentId"),
      );
      if (incident === null) throw notFound("Incident");
      const updates = await dependencies.incidentUpdates.listForIncident(
        incident.id,
      );
      return context.json({ data: updates.map(presentIncidentUpdate) });
    },
  );

  app.post(
    "/:workspaceId/incidents/:incidentId/updates",
    auth,
    requireVerifiedEmail,
    workspace,
    manage,
    active,
    zjson(postSchema),
    async (context) => {
      const update = await postIncidentUpdate.execute({
        workspaceId: context.get("workspace").id,
        actor: context.get("user"),
        actorRole: context.get("role"),
        incidentId: context.req.param("incidentId"),
        message: context.req.valid("json").message,
        ip: requestIp(context),
      });
      return context.json({ data: presentIncidentUpdate(update) }, 201);
    },
  );

  app.delete(
    "/:workspaceId/incidents/:incidentId/updates/:updateId",
    auth,
    requireVerifiedEmail,
    workspace,
    manage,
    active,
    async (context) => {
      await deleteIncidentUpdate.execute({
        workspaceId: context.get("workspace").id,
        actor: context.get("user"),
        actorRole: context.get("role"),
        incidentId: context.req.param("incidentId"),
        updateId: context.req.param("updateId"),
        ip: requestIp(context),
      });
      return context.json({ data: { ok: true } });
    },
  );

  return app;
}
