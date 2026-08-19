import type { MiddlewareHandler } from "hono";
import type { AuthenticateApiKey } from "../../application/api_keys/authenticate_api_key";
import { AppError } from "../../shared/errors";
import type { AppEnv } from "../env";

export interface ApiKeyAuthDependencies {
  authenticateApiKey: Pick<AuthenticateApiKey, "execute">;
}

// Authenticates public API requests with a workspace API key sent either as
// "Authorization: Bearer zgk_…" or in the "X-Api-Key" header. Sets "workspace"
// and "apiKey" on the context; "user"/"role" stay unset on these routes.
export function requireApiKey(
  dependencies: ApiKeyAuthDependencies,
): MiddlewareHandler<AppEnv> {
  return async (context, next) => {
    const authorization = context.req.header("Authorization");
    const bearer = authorization?.match(/^Bearer ([^\s]+)$/u)?.[1];
    const key = bearer ?? context.req.header("X-Api-Key");
    if (key === undefined || key === "") {
      throw new AppError("UNAUTHORIZED", "API key required");
    }

    const result = await dependencies.authenticateApiKey.execute({ key });
    context.set("workspace", result.workspace);
    context.set("apiKey", result.apiKey);
    await next();
  };
}
