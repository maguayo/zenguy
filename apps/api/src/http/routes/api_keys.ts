import { Hono } from "hono";
import { z } from "zod";
import { CreateApiKey } from "../../application/api_keys/create_api_key";
import { ListApiKeys } from "../../application/api_keys/list_api_keys";
import { RevokeApiKey } from "../../application/api_keys/revoke_api_key";
import type { WriteAudit } from "../../application/audit/write_audit";
import type { ApiKeyRepo } from "../../domain/api_keys/repo";
import type { SubscriptionRepo } from "../../domain/billing/repo";
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
import { presentApiKey } from "../presenters/api_key";
import { zjson } from "../validate";

export interface ApiKeyRoutesDependencies {
  users: UserRepo;
  workspaces: WorkspaceRepo;
  members: MemberRepo;
  subscriptions: SubscriptionRepo;
  apiKeys: ApiKeyRepo;
  audit: Pick<WriteAudit, "execute">;
  clock: Clock;
  ids: IdGenerator;
  config: Pick<AppConfig, "jwtSecret">;
}

const createSchema = z.object({ name: z.string() });

function requestIp(context: {
  req: { header(name: string): string | undefined };
}): string | undefined {
  return context.req.header("CF-Connecting-IP");
}

export function apiKeyRoutes(
  dependencies: ApiKeyRoutesDependencies,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const auth = requireAuth(dependencies);
  const workspace = withWorkspace(dependencies);
  const active = requireActiveSubscription(dependencies.subscriptions);
  const createApiKey = new CreateApiKey(
    dependencies.apiKeys,
    dependencies.subscriptions,
    dependencies.audit,
    dependencies.clock,
    dependencies.ids,
  );
  const listApiKeys = new ListApiKeys(dependencies.apiKeys, dependencies.users);
  const revokeApiKey = new RevokeApiKey(
    dependencies.apiKeys,
    dependencies.audit,
    dependencies.clock,
  );

  app.get(
    "/:workspaceId/api-keys",
    auth,
    requireVerifiedEmail,
    workspace,
    async (context) => {
      const result = await listApiKeys.execute({
        workspaceId: context.get("workspace").id,
      });
      return context.json({ data: result.map(presentApiKey) });
    },
  );

  app.post(
    "/:workspaceId/api-keys",
    auth,
    requireVerifiedEmail,
    workspace,
    requireAction("api_keys.manage"),
    active,
    zjson(createSchema),
    async (context) => {
      const result = await createApiKey.execute({
        ...context.req.valid("json"),
        workspaceId: context.get("workspace").id,
        actor: context.get("user"),
        actorRole: context.get("role"),
        ip: requestIp(context),
      });
      return context.json(
        { data: { ...presentApiKey(result.apiKey), key: result.key } },
        201,
      );
    },
  );

  // Revocation is deliberately available without an active subscription.
  app.delete(
    "/:workspaceId/api-keys/:apiKeyId",
    auth,
    requireVerifiedEmail,
    workspace,
    requireAction("api_keys.manage"),
    async (context) => {
      await revokeApiKey.execute({
        workspaceId: context.get("workspace").id,
        apiKeyId: context.req.param("apiKeyId"),
        actor: context.get("user"),
        actorRole: context.get("role"),
        ip: requestIp(context),
      });
      return context.body(null, 204);
    },
  );

  return app;
}
