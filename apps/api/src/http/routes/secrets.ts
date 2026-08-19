import { Hono } from "hono";
import { z } from "zod";
import { CreateSecret } from "../../application/secrets/create_secret";
import { DeleteSecret } from "../../application/secrets/delete_secret";
import { ListSecrets } from "../../application/secrets/list_secrets";
import { ReplaceSecret } from "../../application/secrets/replace_secret";
import type { WriteAudit } from "../../application/audit/write_audit";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import type { SecretRepo } from "../../domain/secrets/repo";
import type { UserRepo } from "../../domain/users/repo";
import type {
  MemberRepo,
  WorkspaceRepo,
} from "../../domain/workspaces/repo";
import type { Clock } from "../../shared/clock";
import type { AppConfig } from "../../shared/config";
import type { IdGenerator } from "../../shared/ids";
import type { AppEnv } from "../env";
import { requireAuth, requireVerifiedEmail } from "../middleware/auth";
import { requireActiveSubscription } from "../middleware/require_subscription";
import { requireAction, withWorkspace } from "../middleware/workspace";
import { presentSecret } from "../presenters/secret";
import { zjson } from "../validate";

export interface SecretRoutesDependencies {
  users: UserRepo;
  workspaces: WorkspaceRepo;
  members: MemberRepo;
  subscriptions: SubscriptionRepo;
  secrets: SecretRepo;
  audit: Pick<WriteAudit, "execute">;
  clock: Clock;
  ids: IdGenerator;
  config: Pick<AppConfig, "jwtSecret" | "encryptionKey">;
}

const createSchema = z.object({
  key: z.string(),
  value: z.string(),
  allowedDomains: z.array(z.string()),
  description: z.string().optional(),
});
const replaceSchema = z
  .object({
    value: z.string().optional(),
    allowedDomains: z.array(z.string()).optional(),
    description: z.string().nullable().optional(),
  })
  .refine(
    (input) =>
      input.value !== undefined ||
      input.allowedDomains !== undefined ||
      input.description !== undefined,
    { message: "At least one field is required" },
  );

function requestIp(context: {
  req: { header(name: string): string | undefined };
}): string | undefined {
  return context.req.header("CF-Connecting-IP");
}

export function secretRoutes(
  dependencies: SecretRoutesDependencies,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const auth = requireAuth(dependencies);
  const workspace = withWorkspace(dependencies);
  const active = requireActiveSubscription(dependencies.subscriptions);
  const createSecret = new CreateSecret(
    dependencies.secrets,
    dependencies.subscriptions,
    dependencies.audit,
    dependencies.config.encryptionKey,
    dependencies.clock,
    dependencies.ids,
  );
  const replaceSecret = new ReplaceSecret(
    dependencies.secrets,
    dependencies.subscriptions,
    dependencies.users,
    dependencies.audit,
    dependencies.config.encryptionKey,
    dependencies.clock,
  );
  const deleteSecret = new DeleteSecret(
    dependencies.secrets,
    dependencies.subscriptions,
    dependencies.audit,
  );
  const listSecrets = new ListSecrets(dependencies.secrets, dependencies.users);

  app.get(
    "/:workspaceId/secrets",
    auth,
    requireVerifiedEmail,
    workspace,
    async (context) => {
      const result = await listSecrets.execute({
        workspaceId: context.get("workspace").id,
      });
      return context.json({ data: result.map(presentSecret) });
    },
  );

  app.post(
    "/:workspaceId/secrets",
    auth,
    requireVerifiedEmail,
    workspace,
    requireAction("secrets.manage"),
    active,
    zjson(createSchema),
    async (context) => {
      const result = await createSecret.execute({
        ...context.req.valid("json"),
        workspaceId: context.get("workspace").id,
        actor: context.get("user"),
        actorRole: context.get("role"),
        ip: requestIp(context),
      });
      return context.json({ data: presentSecret(result) }, 201);
    },
  );

  app.put(
    "/:workspaceId/secrets/:secretId",
    auth,
    requireVerifiedEmail,
    workspace,
    requireAction("secrets.manage"),
    active,
    zjson(replaceSchema),
    async (context) => {
      const result = await replaceSecret.execute({
        ...context.req.valid("json"),
        workspaceId: context.get("workspace").id,
        secretId: context.req.param("secretId"),
        actor: context.get("user"),
        actorRole: context.get("role"),
        ip: requestIp(context),
      });
      return context.json({ data: presentSecret(result) });
    },
  );

  app.delete(
    "/:workspaceId/secrets/:secretId",
    auth,
    requireVerifiedEmail,
    workspace,
    requireAction("secrets.manage"),
    active,
    async (context) => {
      await deleteSecret.execute({
        workspaceId: context.get("workspace").id,
        secretId: context.req.param("secretId"),
        actor: context.get("user"),
        actorRole: context.get("role"),
        ip: requestIp(context),
      });
      return context.body(null, 204);
    },
  );

  return app;
}
