import { Hono } from "hono";
import { z } from "zod";
import { ListAuditLogs } from "../../application/audit/list_audit_logs";
import type { AuditRepo } from "../../domain/audit/repo";
import type { UserRepo } from "../../domain/users/repo";
import type {
  MemberRepo,
  WorkspaceRepo,
} from "../../domain/workspaces/repo";
import type { AppConfig } from "../../shared/config";
import type { AppEnv } from "../env";
import { requireAuth, requireVerifiedEmail } from "../middleware/auth";
import { requireAction, withWorkspace } from "../middleware/workspace";
import { presentAuditLog } from "../presenters/audit";
import { zquery } from "../validate";

export interface AuditRoutesDependencies {
  users: UserRepo;
  workspaces: WorkspaceRepo;
  members: MemberRepo;
  audits: AuditRepo;
  config: Pick<AppConfig, "jwtSecret">;
}

const listQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export function auditRoutes(
  dependencies: AuditRoutesDependencies,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const listAuditLogs = new ListAuditLogs(
    dependencies.audits,
    dependencies.users,
  );

  app.get(
    "/:workspaceId/audit-logs",
    requireAuth(dependencies),
    requireVerifiedEmail,
    withWorkspace(dependencies),
    requireAction("audit.view"),
    zquery(listQuerySchema),
    async (context) => {
      const query = context.req.valid("query");
      const result = await listAuditLogs.execute({
        workspaceId: context.get("workspace").id,
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        limit: query.limit,
      });
      return context.json({
        data: result.auditLogs.map(presentAuditLog),
        nextCursor: result.nextCursor,
      });
    },
  );

  return app;
}
