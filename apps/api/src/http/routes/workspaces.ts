import { Hono } from "hono";
import { z } from "zod";
import { CreateWorkspace } from "../../application/workspaces/create_workspace";
import { GetWorkspace } from "../../application/workspaces/get_workspace";
import { ListMyWorkspaces } from "../../application/workspaces/list_my_workspaces";
import { UpdateWorkspace } from "../../application/workspaces/update_workspace";
import { TransferOwnership } from "../../application/workspaces/transfer_ownership";
import { DeleteWorkspace } from "../../application/workspaces/delete_workspace";
import type { EnsureDefaultEmailChannel } from "../../application/alerts/ensure_default_email_channel";
import type { WriteAudit } from "../../application/audit/write_audit";
import type { BillingCanceller } from "../../domain/billing/canceller";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import type { UserRepo } from "../../domain/users/repo";
import type {
  InvitationRepo,
  MemberRepo,
  WorkspaceRepo,
} from "../../domain/workspaces/repo";
import type { Clock } from "../../shared/clock";
import type { AppConfig } from "../../shared/config";
import type { IdGenerator } from "../../shared/ids";
import type { AppEnv } from "../env";
import { requireAuth, requireVerifiedEmail } from "../middleware/auth";
import { requireAction, withWorkspace } from "../middleware/workspace";
import { presentWorkspace } from "../presenters/workspace";
import { zjson } from "../validate";

export interface WorkspaceRoutesDependencies {
  users: UserRepo;
  workspaces: WorkspaceRepo;
  members: MemberRepo;
  invitations: InvitationRepo;
  billingCanceller: BillingCanceller;
  subscriptions: SubscriptionRepo;
  defaultChannel: Pick<EnsureDefaultEmailChannel, "execute">;
  audit: Pick<WriteAudit, "execute">;
  clock: Clock;
  ids: IdGenerator;
  config: Pick<AppConfig, "jwtSecret">;
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  timezone: z.string().min(1),
});
const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    timezone: z.string().min(1).optional(),
  })
  .refine((input) => input.name !== undefined || input.timezone !== undefined, {
    message: "At least one field is required",
  });
const transferSchema = z.object({ newOwnerUserId: z.string().min(1) });
const deleteSchema = z.object({ confirmName: z.string() });

function requestIp(context: {
  req: { header(name: string): string | undefined };
}): string | undefined {
  return context.req.header("CF-Connecting-IP");
}

export function workspaceRoutes(
  dependencies: WorkspaceRoutesDependencies,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const auth = requireAuth(dependencies);
  const verified = requireVerifiedEmail;
  const workspace = withWorkspace(dependencies);
  const createWorkspace = new CreateWorkspace(dependencies);
  const listMyWorkspaces = new ListMyWorkspaces(
    dependencies.workspaces,
    dependencies.subscriptions,
  );
  const getWorkspace = new GetWorkspace(dependencies.subscriptions);
  const updateWorkspace = new UpdateWorkspace(dependencies);
  const transferOwnership = new TransferOwnership(
    dependencies.workspaces,
    dependencies.members,
    dependencies.audit,
    dependencies.clock,
  );
  const deleteWorkspace = new DeleteWorkspace(
    dependencies.workspaces,
    dependencies.invitations,
    dependencies.billingCanceller,
    dependencies.audit,
    dependencies.clock,
  );

  app.post("/", auth, verified, zjson(createSchema), async (context) => {
    const result = await createWorkspace.execute({
      ...context.req.valid("json"),
      actor: context.get("user"),
      ip: requestIp(context),
    });
    return context.json({ data: presentWorkspace(result) }, 201);
  });

  app.get("/", auth, verified, async (context) => {
    const result = await listMyWorkspaces.execute({
      userId: context.get("user").id,
    });
    return context.json({ data: result.map(presentWorkspace) });
  });

  app.get("/:workspaceId", auth, verified, workspace, async (context) => {
    const result = await getWorkspace.execute({
      workspace: context.get("workspace"),
      role: context.get("role"),
    });
    return context.json({ data: presentWorkspace(result) });
  });

  app.patch(
    "/:workspaceId",
    auth,
    verified,
    workspace,
    requireAction("workspace.settings"),
    zjson(updateSchema),
    async (context) => {
      const result = await updateWorkspace.execute({
        ...context.req.valid("json"),
        workspace: context.get("workspace"),
        role: context.get("role"),
        actor: context.get("user"),
        ip: requestIp(context),
      });
      return context.json({ data: presentWorkspace(result) });
    },
  );

  app.post(
    "/:workspaceId/transfer-ownership",
    auth,
    verified,
    workspace,
    requireAction("workspace.transfer"),
    zjson(transferSchema),
    async (context) => {
      const result = await transferOwnership.execute({
        workspace: context.get("workspace"),
        actor: context.get("user"),
        actorRole: context.get("role"),
        newOwnerUserId: context.req.valid("json").newOwnerUserId,
        ip: requestIp(context),
      });
      return context.json({ data: result });
    },
  );

  app.delete(
    "/:workspaceId",
    auth,
    verified,
    workspace,
    requireAction("workspace.delete"),
    zjson(deleteSchema),
    async (context) => {
      await deleteWorkspace.execute({
        workspace: context.get("workspace"),
        actor: context.get("user"),
        actorRole: context.get("role"),
        confirmName: context.req.valid("json").confirmName,
        ip: requestIp(context),
      });
      return context.body(null, 204);
    },
  );

  return app;
}
