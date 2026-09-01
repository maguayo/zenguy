import { Hono } from "hono";
import { z } from "zod";
import { DeleteAccount } from "../../application/account/delete_account";
import type { WorkspaceDeletionCoordinator } from "../../application/workspaces/delete_workspace";
import type { AccountDeletionRepo } from "../../domain/users/account_deletion";
import type { UserRepo } from "../../domain/users/repo";
import type { MemberRepo, WorkspaceRepo } from "../../domain/workspaces/repo";
import type { Clock } from "../../shared/clock";
import type { AppConfig } from "../../shared/config";
import { MAX_PASSWORD_LENGTH, RATE_LIMITS } from "../../shared/constants";
import { sha256Hex } from "../../shared/crypto";
import {
  enforceRateLimitScopes,
  normalizeRateLimitAddress,
  type RateLimiter,
} from "../../shared/ratelimit";
import { clearRefreshCookieHeader } from "../cookies";
import type { AppEnv } from "../env";
import { requireAuth } from "../middleware/auth";
import { zjson } from "../validate";

export interface AccountRoutesDependencies {
  users: UserRepo;
  workspaces: WorkspaceRepo;
  members: MemberRepo;
  workspaceDeletion: WorkspaceDeletionCoordinator;
  accountDeletion: AccountDeletionRepo;
  rateLimiter: RateLimiter;
  clock: Clock;
  config: Pick<AppConfig, "environment" | "jwtSecret">;
}

const deleteSchema = z.object({
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  confirmation: z.literal("DELETE"),
});

export function accountRoutes(dependencies: AccountRoutesDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const auth = requireAuth(dependencies);
  const deletion = new DeleteAccount(
    dependencies.workspaces,
    dependencies.members,
    dependencies.workspaceDeletion,
    dependencies.accountDeletion,
    dependencies.clock,
  );

  app.delete("/", auth, zjson(deleteSchema), async (context) => {
    const actor = context.get("user");
    const ip = normalizeRateLimitAddress(context.req.header("CF-Connecting-IP"));
    await enforceRateLimitScopes(
      dependencies.rateLimiter,
      [
        `account-delete:user:${await sha256Hex(actor.id)}`,
        `account-delete:ip:${await sha256Hex(ip)}`,
      ],
      RATE_LIMITS.account_delete,
    );
    await deletion.execute({ actor, ...context.req.valid("json") });
    context.header("Cache-Control", "no-store");
    if (context.req.header("X-Zenguy-Client")?.toLowerCase() !== "native") {
      context.header(
        "Set-Cookie",
        clearRefreshCookieHeader(dependencies.config.environment !== "development"),
      );
    }
    return context.body(null, 204);
  });

  return app;
}
