import { Hono } from "hono";
import type { AppEnv } from "./http/env";
import { errorHandler } from "./http/middleware/error_handler";
import { requestId } from "./http/middleware/request_id";
import { securityHeaders } from "./http/middleware/security_headers";
import type { Bindings } from "./shared/config";

export function buildApp(_env: Bindings): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", requestId);
  app.use("*", securityHeaders);
  app.onError(errorHandler);

  app.get("/api/health", (context) => context.json({ data: { ok: true } }));

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
