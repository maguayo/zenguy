import { Hono } from "hono";
import { z } from "zod";
import { ForgotPassword } from "../../application/auth/forgot_password";
import { Login } from "../../application/auth/login";
import { Logout } from "../../application/auth/logout";
import { Refresh } from "../../application/auth/refresh";
import { Register } from "../../application/auth/register";
import { ResendVerification } from "../../application/auth/resend_verification";
import { ResetPassword } from "../../application/auth/reset_password";
import { VerifyEmail } from "../../application/auth/verify_email";
import type { EmailSender } from "../../domain/email/sender";
import type {
  EmailTokenRepo,
  RefreshTokenRepo,
  UserRepo,
} from "../../domain/users/repo";
import type { WorkspaceRepo } from "../../domain/workspaces/repo";
import type { WriteAudit } from "../../application/audit/write_audit";
import type { Clock } from "../../shared/clock";
import type { AppConfig } from "../../shared/config";
import {
  RATE_LIMITS,
  REFRESH_TOKEN_TTL_DAYS,
} from "../../shared/constants";
import { AppError } from "../../shared/errors";
import type { IdGenerator } from "../../shared/ids";
import type { RateLimiter } from "../../shared/ratelimit";
import {
  clearRefreshCookieHeader,
  readRefreshCookie,
  refreshCookieHeader,
} from "../cookies";
import type { AppEnv } from "../env";
import { requireAuth } from "../middleware/auth";
import { presentUser } from "../presenters/user";
import { zjson } from "../validate";

export interface AuthRoutesDependencies {
  users: UserRepo;
  emailTokens: EmailTokenRepo;
  refreshTokens: RefreshTokenRepo;
  workspaces: WorkspaceRepo;
  audit: Pick<WriteAudit, "execute">;
  emailSender: EmailSender;
  rateLimiter: RateLimiter;
  clock: Clock;
  ids: IdGenerator;
  config: AppConfig;
}

const emailSchema = z.email();
const registerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: emailSchema,
  password: z.string().min(8).max(100),
});
const tokenSchema = z.object({ token: z.string().min(1) });
const emailInputSchema = z.object({ email: emailSchema });
const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(100),
});
const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(100),
});

function clientIp(context: { req: { header(name: string): string | undefined } }) {
  return context.req.header("CF-Connecting-IP") ?? "unknown";
}

async function enforceRateLimit(
  limiter: RateLimiter,
  key: string,
  rule: { readonly limit: number; readonly windowSeconds: number },
): Promise<void> {
  const result = await limiter.hit(key, rule.limit, rule.windowSeconds);
  if (!result.allowed) {
    throw new AppError(
      "RATE_LIMITED",
      "Too many requests",
      undefined,
      result.retryAfterSeconds,
    );
  }
}

function sessionPayload(session: {
  user: Parameters<typeof presentUser>[0];
  accessToken: string;
  expiresIn: number;
}) {
  return {
    user: presentUser(session.user),
    accessToken: session.accessToken,
    expiresIn: session.expiresIn,
  };
}

export function authRoutes(
  dependencies: AuthRoutesDependencies,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const register = new Register(dependencies);
  const verifyEmail = new VerifyEmail(dependencies);
  const resendVerification = new ResendVerification(dependencies);
  const login = new Login(dependencies);
  const refresh = new Refresh(dependencies);
  const logout = new Logout(dependencies);
  const forgotPassword = new ForgotPassword(dependencies);
  const resetPassword = new ResetPassword(dependencies);
  const secureCookies = dependencies.config.environment === "production";
  const refreshMaxAge = REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60;

  app.post("/register", zjson(registerSchema), async (context) => {
    await enforceRateLimit(
      dependencies.rateLimiter,
      `register:${clientIp(context)}`,
      RATE_LIMITS.register,
    );
    const user = await register.execute(context.req.valid("json"));
    return context.json({ data: { user: presentUser(user) } }, 201);
  });

  app.post("/verify-email", zjson(tokenSchema), async (context) => {
    const result = await verifyEmail.execute(context.req.valid("json"));
    return context.json({ data: result });
  });

  app.post(
    "/resend-verification",
    zjson(emailInputSchema),
    async (context) => {
      const input = context.req.valid("json");
      await enforceRateLimit(
        dependencies.rateLimiter,
        `resend:${input.email.trim().toLowerCase()}`,
        RATE_LIMITS.resend,
      );
      const result = await resendVerification.execute(input);
      return context.json({ data: result });
    },
  );

  app.post("/login", zjson(loginSchema), async (context) => {
    const input = context.req.valid("json");
    await enforceRateLimit(
      dependencies.rateLimiter,
      `login:ip:${clientIp(context)}`,
      RATE_LIMITS.login,
    );
    await enforceRateLimit(
      dependencies.rateLimiter,
      `login:email:${input.email.trim().toLowerCase()}`,
      RATE_LIMITS.login,
    );
    const session = await login.execute(input);
    context.header(
      "Set-Cookie",
      refreshCookieHeader(
        session.refreshTokenPlain,
        refreshMaxAge,
        secureCookies,
      ),
    );
    return context.json({ data: sessionPayload(session) });
  });

  app.post("/refresh", async (context) => {
    try {
      const refreshTokenPlain = readRefreshCookie(context);
      if (refreshTokenPlain === null) {
        throw new AppError(
          "UNAUTHORIZED",
          "Invalid or expired refresh token",
        );
      }
      const session = await refresh.execute({ refreshTokenPlain });
      context.header(
        "Set-Cookie",
        refreshCookieHeader(
          session.refreshTokenPlain,
          refreshMaxAge,
          secureCookies,
        ),
      );
      return context.json({ data: sessionPayload(session) });
    } catch (error) {
      context.header("Set-Cookie", clearRefreshCookieHeader(secureCookies));
      throw error;
    }
  });

  app.post("/logout", async (context) => {
    await logout.execute({ refreshTokenPlain: readRefreshCookie(context) });
    context.header("Set-Cookie", clearRefreshCookieHeader(secureCookies));
    return context.body(null, 204);
  });

  app.post(
    "/forgot-password",
    zjson(emailInputSchema),
    async (context) => {
      const input = context.req.valid("json");
      await enforceRateLimit(
        dependencies.rateLimiter,
        `forgot:${input.email.trim().toLowerCase()}`,
        RATE_LIMITS.forgot,
      );
      const result = await forgotPassword.execute(input);
      return context.json({ data: result });
    },
  );

  app.post(
    "/reset-password",
    zjson(resetPasswordSchema),
    async (context) => {
      const result = await resetPassword.execute({
        ...context.req.valid("json"),
        ip: clientIp(context),
      });
      return context.json({ data: result });
    },
  );

  app.get("/me", requireAuth(dependencies), (context) =>
    context.json({ data: { user: presentUser(context.get("user")) } }),
  );

  return app;
}
