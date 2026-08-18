import type { MiddlewareHandler } from "hono";
import type { UserRepo } from "../../domain/users/repo";
import { verifyAccessToken } from "../../infrastructure/auth/jwt";
import type { AppConfig } from "../../shared/config";
import { AppError } from "../../shared/errors";
import type { AppEnv } from "../env";

export interface AuthMiddlewareDependencies {
  users: UserRepo;
  config: Pick<AppConfig, "jwtSecret">;
}

function unauthorized(): AppError {
  return new AppError("UNAUTHORIZED", "Authentication required");
}

export function requireAuth(
  dependencies: AuthMiddlewareDependencies,
): MiddlewareHandler<AppEnv> {
  return async (context, next) => {
    const authorization = context.req.header("Authorization");
    const match = authorization?.match(/^Bearer ([^\s]+)$/u);
    if (match === undefined || match === null) throw unauthorized();

    const token = match[1];
    if (token === undefined) throw unauthorized();
    const claims = await verifyAccessToken(dependencies.config, token);
    const user = await dependencies.users.findById(claims.sub);
    if (user === null) throw unauthorized();

    context.set("user", user);
    await next();
  };
}

export const requireVerifiedEmail: MiddlewareHandler<AppEnv> = async (
  context,
  next,
) => {
  const user = context.get("user");
  if (user === undefined) throw unauthorized();
  if (user.emailVerifiedAt === null) {
    throw new AppError("EMAIL_NOT_VERIFIED", "Verify your email to continue");
  }
  await next();
};
