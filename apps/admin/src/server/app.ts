import { Hono } from "hono";
import type { AppEnv, Bindings, Clock } from "./env";
import { systemClock } from "./env";
import { AppError } from "./errors";
import { authRoutes } from "./routes/auth";
import type { Loaders } from "./routes/data";
import { dataRoutes } from "./routes/data";

export interface AppOverrides {
  clock?: Clock;
  fetch?: typeof fetch;
  delay?: (milliseconds: number) => Promise<void>;
  loaders?: Partial<Loaders>;
}

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "same-origin");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Content-Security-Policy", CSP);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function buildApp(env: Bindings, overrides: AppOverrides = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const clock = overrides.clock ?? systemClock;
  const fetchImpl = overrides.fetch ?? fetch.bind(globalThis);
  const delay =
    overrides.delay ??
    ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

  // Hardens every successful response. Errors never come back through here --
  // a throw unwinds straight past the post-next() code to onError -- so onError
  // applies the same headers itself. Both are required; do not DRY one away.
  app.use("*", async (context, next) => {
    await next();
    const hardened = withSecurityHeaders(context.res);
    context.res = undefined;
    context.res = hardened;
  });

  app.use("/api/*", async (context, next) => {
    await next();
    context.header("Cache-Control", "no-store");
  });

  app.onError((error, context) => {
    const appError =
      error instanceof AppError ? error : new AppError("INTERNAL", "Unexpected error");
    if (appError.code === "INTERNAL") {
      console.error("admin_unhandled_error", error);
    }
    const response = context.json(
      {
        error: {
          code: appError.code,
          message: appError.message,
          ...(appError.details ? { details: appError.details } : {}),
        },
      },
      appError.status as 400,
    );
    response.headers.set("Cache-Control", "no-store");
    return withSecurityHeaders(response);
  });

  app.route(
    "/api/auth",
    authRoutes({
      adminEmails: env.ADMIN_EMAILS,
      secret: env.ADMIN_SESSION_SECRET,
      apiOrigin: env.ZENGUY_API_ORIGIN,
      fetch: fetchImpl,
      clock,
      delay,
    }),
  );

  app.route(
    "/api",
    dataRoutes({
      db: env.DB,
      clock,
      adminEmails: env.ADMIN_EMAILS,
      secret: env.ADMIN_SESSION_SECRET,
      loaders: overrides.loaders,
    }),
  );

  app.all("/api/*", () => {
    throw new AppError("NOT_FOUND", "Route not found");
  });

  app.all("*", (context) => env.ASSETS.fetch(context.req.raw));

  return app;
}
