import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { isAdminEmail } from "../allowlist";
import { LOGIN_FAILURE_DELAY_MS, SESSION_TTL_MS } from "../constants";
import type { AppEnv, Clock } from "../env";
import { AppError } from "../errors";
import { requireSession } from "../require_session";
import { clearSessionCookie, sessionCookie, signSession } from "../session";

export interface AuthRoutesDependencies {
  adminEmails: string;
  secret: string;
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

type Verdict = "valid" | "invalid" | "rate_limited" | "unavailable";

async function verifyWithApi(
  deps: AuthRoutesDependencies,
  email: string,
  password: string,
): Promise<Verdict> {
  let response: Response;
  try {
    response = await deps.fetch(`${deps.apiOrigin.replace(/\/$/u, "")}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "zenguy-admin/1.0" },
      body: JSON.stringify({ email, password }),
      // A hung API must not hold the login request open: the abort throws and
      // lands on the "unavailable" path below like any other transport failure.
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return "unavailable";
  }
  if (response.status === 200) return "valid";
  if (response.status === 429) return "rate_limited";
  if (response.status === 401 || response.status === 403 || response.status === 400) {
    return "invalid";
  }
  return "unavailable";
}

export function authRoutes(deps: AuthRoutesDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

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
      if (!isAdminEmail(deps.adminEmails, email)) return reject();
      const verdict = await verifyWithApi(deps, email, password);
      if (verdict === "invalid") return reject();
      if (verdict === "rate_limited") {
        throw new AppError("RATE_LIMITED", "Too many attempts, try again later");
      }
      if (verdict === "unavailable") {
        throw new AppError("SERVICE_UNAVAILABLE", "Production API is not reachable");
      }
      const token = await signSession(
        { email, exp: deps.clock.now() + SESSION_TTL_MS },
        deps.secret,
      );
      context.header("Set-Cookie", sessionCookie(token, SESSION_TTL_MS / 1_000));
      return context.json({ data: { email } });
    },
  );

  app.post("/logout", (context) => {
    context.header("Set-Cookie", clearSessionCookie());
    return context.body(null, 204);
  });

  app.get("/me", requireSession(deps), (context) =>
    context.json({ data: { email: context.get("adminEmail") } }),
  );

  return app;
}
