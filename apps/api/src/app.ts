import { Hono } from "hono";
import type { EmailSender } from "./domain/email/sender";
import type { AuditRepo } from "./domain/audit/repo";
import type {
  EmailTokenRepo,
  RefreshTokenRepo,
  UserRepo,
} from "./domain/users/repo";
import type { MemberRepo, WorkspaceRepo } from "./domain/workspaces/repo";
import type { AppEnv } from "./http/env";
import { errorHandler } from "./http/middleware/error_handler";
import { requestId } from "./http/middleware/request_id";
import { securityHeaders } from "./http/middleware/security_headers";
import { authRoutes } from "./http/routes/auth";
import { workspaceRoutes } from "./http/routes/workspaces";
import { WriteAudit } from "./application/audit/write_audit";
import { D1AuditRepo } from "./infrastructure/db/audit_repo";
import { D1EmailTokenRepo } from "./infrastructure/db/email_token_repo";
import { D1RefreshTokenRepo } from "./infrastructure/db/refresh_token_repo";
import { D1UserRepo } from "./infrastructure/db/user_repo";
import { D1MemberRepo } from "./infrastructure/db/member_repo";
import { D1WorkspaceRepo } from "./infrastructure/db/workspace_repo";
import { buildEmailSender } from "./infrastructure/email";
import type { Clock } from "./shared/clock";
import { systemClock } from "./shared/clock";
import { loadConfig, type Bindings } from "./shared/config";
import type { IdGenerator } from "./shared/ids";
import { realIds } from "./shared/ids";
import { KvRateLimiter, type RateLimiter } from "./shared/ratelimit";

export interface AppOverrides {
  clock?: Clock;
  ids?: IdGenerator;
  users?: UserRepo;
  emailTokens?: EmailTokenRepo;
  refreshTokens?: RefreshTokenRepo;
  emailSender?: EmailSender;
  rateLimiter?: RateLimiter;
  workspaces?: WorkspaceRepo;
  members?: MemberRepo;
  audits?: AuditRepo;
}

export function buildApp(
  env: Bindings,
  overrides: AppOverrides = {},
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const config = loadConfig(env);
  const clock = overrides.clock ?? systemClock;
  const users = overrides.users ?? new D1UserRepo(env.DB);
  const emailTokens =
    overrides.emailTokens ?? new D1EmailTokenRepo(env.DB);
  const refreshTokens =
    overrides.refreshTokens ?? new D1RefreshTokenRepo(env.DB);
  const emailSender = overrides.emailSender ?? buildEmailSender(config);
  const rateLimiter =
    overrides.rateLimiter ?? new KvRateLimiter(env.KV, clock);
  const workspaces = overrides.workspaces ?? new D1WorkspaceRepo(env.DB);
  const members = overrides.members ?? new D1MemberRepo(env.DB);
  const audits = overrides.audits ?? new D1AuditRepo(env.DB);
  const audit = new WriteAudit({
    audits,
    clock,
    ids: overrides.ids ?? realIds,
  });

  app.use("*", requestId);
  app.use("*", securityHeaders);
  app.onError(errorHandler);

  app.get("/api/health", (context) => context.json({ data: { ok: true } }));
  app.route(
    "/api/auth",
    authRoutes({
      users,
      emailTokens,
      refreshTokens,
      emailSender,
      rateLimiter,
      clock,
      ids: overrides.ids ?? realIds,
      config,
    }),
  );
  app.route(
    "/api/workspaces",
    workspaceRoutes({
      users,
      workspaces,
      members,
      audit,
      clock,
      ids: overrides.ids ?? realIds,
      config,
    }),
  );

  app.notFound((context) => {
    if (context.req.path.startsWith("/api/")) {
      return context.json(
        { error: { code: "NOT_FOUND", message: "Route not found" } },
        404,
      );
    }
    return new Response("Not Found", { status: 404 });
  });

  return app;
}
