import { Hono } from "hono";
import { z } from "zod";
import { GetIncident } from "../../application/incidents/get_incident";
import { ListIncidents } from "../../application/incidents/list_incidents";
import type { DeliveryRepo } from "../../domain/channels/repo";
import type {
  IncidentEventRepo,
  IncidentRepo,
} from "../../domain/incidents/repo";
import type { UserRepo } from "../../domain/users/repo";
import type {
  MemberRepo,
  WorkspaceRepo,
} from "../../domain/workspaces/repo";
import type { Clock } from "../../shared/clock";
import type { AppConfig } from "../../shared/config";
import type { AppEnv } from "../env";
import { requireAuth, requireVerifiedEmail } from "../middleware/auth";
import { withWorkspace } from "../middleware/workspace";
import {
  presentIncident,
  presentIncidentDetail,
} from "../presenters/incident";
import { zquery } from "../validate";

export interface IncidentRoutesDependencies {
  users: UserRepo;
  workspaces: WorkspaceRepo;
  members: MemberRepo;
  incidents: IncidentRepo;
  incidentEvents: IncidentEventRepo;
  deliveries: DeliveryRepo;
  clock: Clock;
  config: Pick<AppConfig, "jwtSecret">;
}

const listQuerySchema = z.object({
  status: z.enum(["open", "resolved"]).optional(),
  type: z.enum(["browser", "uptime"]).optional(),
  from: z.string().min(1).optional(),
  to: z.string().min(1).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export function incidentRoutes(
  dependencies: IncidentRoutesDependencies,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const auth = requireAuth(dependencies);
  const workspace = withWorkspace(dependencies);
  const listIncidents = new ListIncidents(
    dependencies.incidents,
    dependencies.clock,
  );
  const getIncident = new GetIncident(
    dependencies.incidents,
    dependencies.incidentEvents,
    dependencies.deliveries,
    dependencies.clock,
  );

  app.get(
    "/:workspaceId/incidents",
    auth,
    requireVerifiedEmail,
    workspace,
    zquery(listQuerySchema),
    async (context) => {
      const query = context.req.valid("query");
      const result = await listIncidents.execute({
        workspaceId: context.get("workspace").id,
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.type === undefined ? {} : { type: query.type }),
        ...(query.from === undefined ? {} : { from: query.from }),
        ...(query.to === undefined ? {} : { to: query.to }),
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        limit: query.limit,
      });
      return context.json({
        data: result.incidents.map(presentIncident),
        nextCursor: result.nextCursor,
      });
    },
  );

  app.get(
    "/:workspaceId/incidents/:incidentId",
    auth,
    requireVerifiedEmail,
    workspace,
    async (context) => {
      const result = await getIncident.execute({
        workspaceId: context.get("workspace").id,
        incidentId: context.req.param("incidentId"),
      });
      return context.json({ data: presentIncidentDetail(result) });
    },
  );

  return app;
}
