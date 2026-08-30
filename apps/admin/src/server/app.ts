import { Hono } from "hono";
import type { AppEnv, Bindings, Clock } from "./env";
import { systemClock } from "./env";
import { AppError } from "./errors";
import { MAX_ADMIN_API_REQUEST_BODY_BYTES } from "./constants";
import { parseAdminUserIds } from "./allowlist";
import { authRoutes } from "./routes/auth";
import type { Loaders } from "./routes/data";
import { dataRoutes } from "./routes/data";
import { D1AdminSessionStore, type AdminSessionStore } from "./admin_sessions";
import { cloudflareAccessVerifier, type AccessVerifier } from "./access";
import { strictBodyLimit } from "./strict_body_limit";

export interface AppOverrides {
  clock?: Clock;
  fetch?: typeof fetch;
  delay?: (milliseconds: number) => Promise<void>;
  loaders?: Partial<Loaders>;
  sessions?: AdminSessionStore;
  accessVerifier?: AccessVerifier;
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
  headers.set("Strict-Transport-Security", "max-age=31536000");
  headers.set("Content-Security-Policy", CSP);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function buildApp(env: Bindings, overrides: AppOverrides = {}): Hono<AppEnv> {
  // Parse once per Worker version and fail closed before any route or asset is
  // reachable. Never include the secret binding's contents in an error/log.
  const adminUserIds = parseAdminUserIds(env.ADMIN_USER_IDS);
  const app = new Hono<AppEnv>();
  const clock = overrides.clock ?? systemClock;
  const fetchImpl = overrides.fetch ?? fetch.bind(globalThis);
  const sessions = overrides.sessions ?? new D1AdminSessionStore(env.DB);
  const accessVerifier =
    overrides.accessVerifier ??
    cloudflareAccessVerifier({
      teamDomain: env.CF_ACCESS_TEAM_DOMAIN,
      audience: env.CF_ACCESS_AUD,
    });
  const delay =
    overrides.delay ??
      ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

  // Static Assets currently run through an internal router that does not pass
  // ctx.access to the user Worker, so validate the signed assertion explicitly.
  app.use("*", async (context, next) => {
    const identity = await accessVerifier.verify(context.req.raw);
    if (identity === null) throw new AppError("FORBIDDEN", "Cloudflare Access required");
    context.set("accessEmail", identity.email);
    context.set("accessSubject", identity.subject);
    await next();
  });

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

  // Count every stream even when Content-Length is absent or understated.
  // This runs before login's JSON validator, so an attacker cannot make the
  // Worker materialize an arbitrarily large credential payload.
  app.use(
    "/api/*",
    strictBodyLimit({
      maxSize: MAX_ADMIN_API_REQUEST_BODY_BYTES,
      onError: (context) =>
        context.json(
          { error: { code: "PAYLOAD_TOO_LARGE", message: "Request body too large" } },
          413,
        ),
    }),
  );

  app.onError((error, context) => {
    const appError =
      error instanceof AppError ? error : new AppError("INTERNAL", "Unexpected error");
    if (appError.code === "INTERNAL") {
      // Never serialize the raw exception: D1/fetch/parser messages may contain
      // query values, URLs or credentials.
      console.error(
        JSON.stringify({
          event: "admin_unhandled_error",
          method: context.req.method,
          path: context.req.path,
          t: Date.now(),
        }),
      );
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
      adminUserIds,
      sessions,
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
      adminUserIds,
      sessions,
      analytics: {
        fetch: fetchImpl,
        token: env.CF_ANALYTICS_API_TOKEN,
        accountId: env.CLOUDFLARE_ACCOUNT_ID,
      },
      loaders: overrides.loaders,
    }),
  );

  app.all("/api/*", () => {
    throw new AppError("NOT_FOUND", "Route not found");
  });

  app.all("*", (context) => env.ASSETS.fetch(context.req.raw));

  return app;
}
