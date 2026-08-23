import { createMiddleware } from "hono/factory";
import { isAdminEmail } from "./allowlist";
import { SESSION_COOKIE } from "./constants";
import type { AppEnv, Clock } from "./env";
import { AppError } from "./errors";
import { readCookie, verifySession } from "./session";

export interface SessionDependencies {
  adminEmails: string;
  secret: string;
  clock: Clock;
}

/**
 * Requires a valid, unexpired session cookie whose email is still in
 * ADMIN_EMAILS. Re-checking the allowlist on every request means dropping an
 * address from the var revokes access immediately instead of after the cookie's
 * seven days.
 */
export function requireSession(deps: SessionDependencies) {
  return createMiddleware<AppEnv>(async (context, next) => {
    const token = readCookie(context.req.header("Cookie"), SESSION_COOKIE);
    const session =
      token === null ? null : await verifySession(token, deps.secret, deps.clock.now());
    if (session === null || !isAdminEmail(deps.adminEmails, session.email)) {
      throw new AppError("UNAUTHORIZED", "Admin session required");
    }
    context.set("adminEmail", session.email);
    await next();
  });
}
