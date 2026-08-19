import { Hono } from "hono";
import { z } from "zod";
import { ChangeMemberRole } from "../../application/members/change_member_role";
import { ListMembers } from "../../application/members/list_members";
import { RemoveMember } from "../../application/members/remove_member";
import type { WriteAudit } from "../../application/audit/write_audit";
import type { UserRepo } from "../../domain/users/repo";
import type { MemberRepo, WorkspaceRepo } from "../../domain/workspaces/repo";
import type { AppConfig } from "../../shared/config";
import type { AppEnv } from "../env";
import { requireAuth, requireVerifiedEmail } from "../middleware/auth";
import { requireAction, withWorkspace } from "../middleware/workspace";
import { presentMember } from "../presenters/member";
import { zjson } from "../validate";

export interface MemberRoutesDependencies {
  users: UserRepo;
  workspaces: WorkspaceRepo;
  members: MemberRepo;
  audit: Pick<WriteAudit, "execute">;
  config: Pick<AppConfig, "jwtSecret">;
}

const roleSchema = z.object({ role: z.enum(["ADMIN", "MEMBER"]) });

function requestIp(context: {
  req: { header(name: string): string | undefined };
}): string | undefined {
  return context.req.header("CF-Connecting-IP");
}

export function memberRoutes(
  dependencies: MemberRoutesDependencies,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const auth = requireAuth(dependencies);
  const workspace = withWorkspace(dependencies);
  const listMembers = new ListMembers(dependencies.members);
  const changeRole = new ChangeMemberRole(
    dependencies.members,
    dependencies.audit,
  );
  const removeMember = new RemoveMember(
    dependencies.members,
    dependencies.audit,
  );

  app.get(
    "/:workspaceId/members",
    auth,
    requireVerifiedEmail,
    workspace,
    async (context) => {
      const result = await listMembers.execute({
        workspaceId: context.get("workspace").id,
      });
      return context.json({ data: result.map(presentMember) });
    },
  );

  app.patch(
    "/:workspaceId/members/:userId",
    auth,
    requireVerifiedEmail,
    workspace,
    requireAction("admins.manage"),
    zjson(roleSchema),
    async (context) => {
      const result = await changeRole.execute({
        workspaceId: context.get("workspace").id,
        actor: context.get("user"),
        actorRole: context.get("role"),
        targetUserId: context.req.param("userId"),
        role: context.req.valid("json").role,
        ip: requestIp(context),
      });
      return context.json({ data: presentMember(result) });
    },
  );

  app.delete(
    "/:workspaceId/members/:userId",
    auth,
    requireVerifiedEmail,
    workspace,
    requireAction("members.remove"),
    async (context) => {
      await removeMember.execute({
        workspaceId: context.get("workspace").id,
        actor: context.get("user"),
        actorRole: context.get("role"),
        targetUserId: context.req.param("userId"),
        ip: requestIp(context),
      });
      return context.body(null, 204);
    },
  );

  return app;
}
