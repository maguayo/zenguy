import { createMiddleware } from "hono/factory";
import type { AdminSessionStore } from "./admin_sessions";
import { isAdminUserId, type AdminUserIds } from "./allowlist";
import { SESSION_COOKIE } from "./constants";
import type { AppEnv, Clock } from "./env";
import { AppError } from "./errors";
import { isWellFormedSessionToken, readCookie, sessionTokenHash } from "./session";

export interface SessionDependencies {
  adminUserIds: AdminUserIds;
  sessions: AdminSessionStore;
  clock: Clock;
}

/**
 * Resolves an opaque session from D1 on every request. Access disappears as
 * soon as the row is revoked, the account password/auth version changes, email
 * verification is removed, or the stable user id leaves the allowlist.
 */
export function requireSession(deps: SessionDependencies) {
  return createMiddleware<AppEnv>(async (context, next) => {
    const token = readCookie(context.req.header("Cookie"), SESSION_COOKIE);
    const session =
      token === null || !isWellFormedSessionToken(token)
        ? null
        : await deps.sessions.findActive(
            await sessionTokenHash(token, context.get("accessSubject")),
            deps.clock.now(),
          );
    if (
      session === null ||
      !isAdminUserId(deps.adminUserIds, session.userId) ||
      session.email.toLowerCase() !== context.get("accessEmail")
    ) {
      throw new AppError("UNAUTHORIZED", "Admin session required");
    }
    context.set("adminEmail", session.email);
    context.set("adminUserId", session.userId);
    await next();
  });
}
