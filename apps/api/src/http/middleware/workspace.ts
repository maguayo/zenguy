import type { MiddlewareHandler } from "hono";
import type {
  MemberRepo,
  WorkspaceRepo,
} from "../../domain/workspaces/repo";
import { can, type Action } from "../../domain/workspaces/permissions";
import { AppError, forbidden, notFound } from "../../shared/errors";
import type { AppEnv } from "../env";

export interface WorkspaceMiddlewareDependencies {
  workspaces: WorkspaceRepo;
  members: MemberRepo;
}

export function withWorkspace(
  dependencies: WorkspaceMiddlewareDependencies,
): MiddlewareHandler<AppEnv> {
  return async (context, next) => {
    const user = context.get("user");
    if (user === undefined) {
      throw new AppError("UNAUTHORIZED", "Authentication required");
    }

    const workspaceId = context.req.param("workspaceId");
    if (workspaceId === undefined) throw notFound("Workspace");
    const workspace = await dependencies.workspaces.findById(workspaceId);
    if (workspace === null) throw notFound("Workspace");

    const member = await dependencies.members.find(workspace.id, user.id);
    if (member === null) {
      // Deliberately indistinguishable from an absent workspace.
      throw notFound("Workspace");
    }

    context.set("workspace", workspace);
    context.set("role", member.role);
    await next();
  };
}

export function requireAction(action: Action): MiddlewareHandler<AppEnv> {
  return async (context, next) => {
    const role = context.get("role");
    if (role === undefined || !can(role, action)) throw forbidden();
    await next();
  };
}
