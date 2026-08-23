import { Hono } from "hono";
import { z } from "zod";
import type { WriteAudit } from "../../application/audit/write_audit";
import { GetSubscriptionGrantPublic } from "../../application/billing/get_subscription_grant_public";
import { IssueSubscriptionGrant } from "../../application/billing/issue_subscription_grant";
import { ListSubscriptionGrants } from "../../application/billing/list_subscription_grants";
import { RedeemSubscriptionGrant } from "../../application/billing/redeem_subscription_grant";
import type {
  SubscriptionGrantRepo,
  SubscriptionRepo,
} from "../../domain/billing/repo";
import type { UserRepo } from "../../domain/users/repo";
import type {
  MemberRepo,
  WorkspaceRepo,
} from "../../domain/workspaces/repo";
import type { Clock } from "../../shared/clock";
import type { AppConfig } from "../../shared/config";
import { RATE_LIMITS } from "../../shared/constants";
import { AppError } from "../../shared/errors";
import type { IdGenerator } from "../../shared/ids";
import type { RateLimiter } from "../../shared/ratelimit";
import type { AppEnv } from "../env";
import { requireAuth, requireVerifiedEmail } from "../middleware/auth";
import {
  presentIssuedGrant,
  presentListedGrant,
  presentPublicGrant,
} from "../presenters/subscription_grant";
import { zjson } from "../validate";

export interface SubscriptionGrantRoutesDependencies {
  users: UserRepo;
  workspaces: WorkspaceRepo;
  members: MemberRepo;
  subscriptions: SubscriptionRepo;
  grants: SubscriptionGrantRepo;
  audit: Pick<WriteAudit, "execute">;
  rateLimiter: RateLimiter;
  clock: Clock;
  ids: IdGenerator;
  config: Pick<AppConfig, "appUrl" | "jwtSecret" | "complimentaryIssuerEmails">;
}

const issueSchema = z.object({
  note: z.string().max(200).optional(),
});

const tokenSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{1,512}$/u),
});

const redeemSchema = tokenSchema.extend({
  workspaceId: z.string().min(1),
});

function requestIp(context: {
  req: { header(name: string): string | undefined };
}): string | undefined {
  return context.req.header("CF-Connecting-IP");
}

export function subscriptionGrantRoutes(
  dependencies: SubscriptionGrantRoutesDependencies,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const auth = requireAuth(dependencies);
  const issueGrant = new IssueSubscriptionGrant(
    dependencies.grants,
    dependencies.audit,
    dependencies.clock,
    dependencies.ids,
    dependencies.config,
  );
  const listGrants = new ListSubscriptionGrants(
    dependencies.grants,
    dependencies.config,
  );
  const getPublic = new GetSubscriptionGrantPublic(
    dependencies.grants,
    dependencies.clock,
  );
  const redeemGrant = new RedeemSubscriptionGrant(
    dependencies.grants,
    dependencies.subscriptions,
    dependencies.workspaces,
    dependencies.members,
    dependencies.audit,
    dependencies.clock,
    dependencies.ids,
  );

  app.post(
    "/",
    auth,
    requireVerifiedEmail,
    zjson(issueSchema),
    async (context) => {
      const actor = context.get("user");
      const limited = await dependencies.rateLimiter.hit(
        `subscription_grants:${actor.id}`,
        RATE_LIMITS.subscription_grants.limit,
        RATE_LIMITS.subscription_grants.windowSeconds,
      );
      if (!limited.allowed) {
        throw new AppError(
          "RATE_LIMITED",
          "Too many requests",
          undefined,
          limited.retryAfterSeconds,
        );
      }
      const result = await issueGrant.execute({
        actor,
        note: context.req.valid("json").note,
        ip: requestIp(context),
      });
      return context.json({ data: presentIssuedGrant(result) }, 201);
    },
  );

  app.get("/", auth, requireVerifiedEmail, async (context) => {
    const result = await listGrants.execute({ actor: context.get("user") });
    return context.json({ data: result.map(presentListedGrant) });
  });

  app.post("/preview", zjson(tokenSchema), async (context) => {
    const result = await getPublic.execute({
      tokenPlain: context.req.valid("json").token,
    });
    return context.json({ data: presentPublicGrant(result) });
  });

  app.post(
    "/redeem",
    auth,
    requireVerifiedEmail,
    zjson(redeemSchema),
    async (context) => {
      const result = await redeemGrant.execute({
        tokenPlain: context.req.valid("json").token,
        workspaceId: context.req.valid("json").workspaceId,
        actor: context.get("user"),
        ip: requestIp(context),
      });
      return context.json({ data: result });
    },
  );

  return app;
}
