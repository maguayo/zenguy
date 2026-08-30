import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";

export const securityHeaders = createMiddleware<AppEnv>(
  async (context, next) => {
    await next();
    context.header("X-Content-Type-Options", "nosniff");
    if (!context.res.headers.has("Referrer-Policy")) {
      context.header("Referrer-Policy", "same-origin");
    }
    context.header("X-Frame-Options", "DENY");
  },
);
