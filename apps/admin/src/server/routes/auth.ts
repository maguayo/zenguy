import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { AdminIdentity, AdminSessionStore } from "../admin_sessions";
import { isAdminUserId, type AdminUserIds } from "../allowlist";
import { LOGIN_FAILURE_DELAY_MS, SESSION_COOKIE, SESSION_TTL_MS } from "../constants";
import type { AppEnv, Clock } from "../env";
import { AppError } from "../errors";
import { requireSession } from "../require_session";
import {
  cancelResponseBody,
  readLimitedJsonResponse,
} from "../limited_response";
import {
  clearSessionCookie,
  isWellFormedSessionToken,
  newSessionToken,
  readCookie,
  sessionCookie,
  sessionTokenHash,
} from "../session";

export interface AuthRoutesDependencies {
  adminUserIds: AdminUserIds;
  sessions: AdminSessionStore;
  apiOrigin: string;
  fetch: typeof fetch;
  clock: Clock;
  delay: (milliseconds: number) => Promise<void>;
}

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  password: z.string().min(1).max(100),
});

/** Upper bound for the delegated login call to the production API. */
const UPSTREAM_TIMEOUT_MS = 10_000;
const MAX_UPSTREAM_RESPONSE_BYTES = 64 * 1_024;

type Verdict =
  | { kind: "valid"; userId: string; email: string }
  | { kind: "invalid" }
  | { kind: "rate_limited" }
  | { kind: "unavailable" };

const PRODUCTION_API_ORIGIN = "https://api.zenguy.com";

function loginEndpoint(rawOrigin: string): string {
  let origin: URL;
  try {
    origin = new URL(rawOrigin);
  } catch {
    throw new Error("ZENGUY_API_ORIGIN must be the production API origin");
  }
  const production = origin.origin === PRODUCTION_API_ORIGIN;
  const loopbackDevelopment =
    origin.protocol === "http:" &&
    (origin.hostname === "127.0.0.1" || origin.hostname === "localhost") &&
    origin.port !== "";
  if (
    (!production && !loopbackDevelopment) ||
    origin.username !== "" ||
    origin.password !== "" ||
    origin.pathname !== "/" ||
    origin.search !== "" ||
    origin.hash !== ""
  ) {
    throw new Error("ZENGUY_API_ORIGIN must be the production API origin");
  }
  return `${origin.origin}/api/auth/login`;
}

const upstreamLoginSchema = z.object({
  data: z.object({
    user: z.object({
      id: z.string().min(1).max(128),
      email: z.email().max(254),
      emailVerified: z.literal(true),
    }),
  }),
});

async function verifyWithApi(
  deps: AuthRoutesDependencies,
  endpoint: string,
  email: string,
  password: string,
): Promise<Verdict> {
  let response: Response;
  try {
    response = await deps.fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "zenguy-admin/1.0" },
      body: JSON.stringify({ email, password }),
      // A hung API must not hold the login request open: the abort throws and
      // lands on the "unavailable" path below like any other transport failure.
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return { kind: "unavailable" };
  }
  if (response.status === 200) {
    let payload: unknown;
    try {
      payload = await readLimitedJsonResponse(
        response,
        MAX_UPSTREAM_RESPONSE_BYTES,
      );
    } catch {
      return { kind: "unavailable" };
    }
    const parsed = upstreamLoginSchema.safeParse(payload);
    if (!parsed.success) return { kind: "invalid" };
    const upstream = parsed.data.data.user;
    if (upstream.email.trim().toLowerCase() !== email) return { kind: "invalid" };
    return { kind: "valid", userId: upstream.id, email: upstream.email.trim().toLowerCase() };
  }
  await cancelResponseBody(response);
  if (response.status === 429) return { kind: "rate_limited" };
  if (response.status === 401 || response.status === 403 || response.status === 400) {
    return { kind: "invalid" };
  }
  return { kind: "unavailable" };
}

async function resolveAdminIdentity(
  deps: AuthRoutesDependencies,
  verdict: Extract<Verdict, { kind: "valid" }>,
): Promise<AdminIdentity | null> {
  if (!isAdminUserId(deps.adminUserIds, verdict.userId)) return null;
  return deps.sessions.findEligibleIdentity(verdict.userId, verdict.email);
}

export function authRoutes(deps: AuthRoutesDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  // Validate once at isolate construction, before accepting any password.
  const endpoint = loginEndpoint(deps.apiOrigin);

  app.post(
    "/login",
    zValidator("json", loginSchema, (result) => {
      if (!result.success) throw new AppError("VALIDATION_ERROR", "Invalid login payload");
    }),
    async (context) => {
      const { email, password } = context.req.valid("json");
      const reject = async (): Promise<never> => {
        await deps.delay(LOGIN_FAILURE_DELAY_MS);
        throw new AppError("UNAUTHORIZED", "Invalid credentials");
      };
      // The Access gate and this credential login are independent factors by
      // design: the Access identity may be a different inbox than the Zenguy
      // account signing in. Never require the two emails to match — the
      // ADMIN_USER_IDS allowlist, not any email, decides who gets in.
      const verdict = await verifyWithApi(deps, endpoint, email, password);
      if (verdict.kind === "invalid") return reject();
      if (verdict.kind === "rate_limited") {
        throw new AppError("RATE_LIMITED", "Too many attempts, try again later");
      }
      if (verdict.kind === "unavailable") {
        throw new AppError("SERVICE_UNAVAILABLE", "Production API is not reachable");
      }
      const identity = await resolveAdminIdentity(deps, verdict);
      if (identity === null) return reject();
      const now = deps.clock.now();
      const token = newSessionToken();
      await deps.sessions.create({
        ...identity,
        idHash: await sessionTokenHash(token, context.get("accessSubject")),
        createdAt: now,
        expiresAt: now + SESSION_TTL_MS,
      });
      context.header("Set-Cookie", sessionCookie(token, SESSION_TTL_MS / 1_000));
      return context.json({ data: { email: identity.email } });
    },
  );

  app.post("/logout", async (context) => {
    context.header("Set-Cookie", clearSessionCookie());
    const token = readCookie(context.req.header("Cookie"), SESSION_COOKIE);
    if (token !== null && isWellFormedSessionToken(token)) {
      await deps.sessions.revoke(
        await sessionTokenHash(token, context.get("accessSubject")),
        deps.clock.now(),
      );
    }
    return context.body(null, 204);
  });

  app.get("/me", requireSession(deps), (context) =>
    context.json({ data: { email: context.get("adminEmail") } }),
  );

  return app;
}
