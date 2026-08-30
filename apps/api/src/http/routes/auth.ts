import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import {
  newPasswordIssues,
  passwordCodePointLength,
} from "../../shared/password_policy";
import { sha256Hex } from "../../shared/crypto";
import { ForgotPassword } from "../../application/auth/forgot_password";
import { Login } from "../../application/auth/login";
import { Logout } from "../../application/auth/logout";
import { Refresh } from "../../application/auth/refresh";
import { Register } from "../../application/auth/register";
import { GoogleLogin } from "../../application/auth/google_login";
import { ResendVerification } from "../../application/auth/resend_verification";
import { ResetPassword } from "../../application/auth/reset_password";
import type { AuthSession } from "../../application/auth/session";
import { VerifyEmail } from "../../application/auth/verify_email";
import type { EmailSender } from "../../domain/email/sender";
import type { LegalAcceptanceRepo } from "../../domain/users/legal_acceptance";
import type { OAuthIdentityRepo } from "../../domain/users/oauth_identity";
import type {
  EmailTokenRepo,
  RefreshTokenRepo,
  SessionSecurityRepo,
  UserRepo,
} from "../../domain/users/repo";
import type { WorkspaceRepo } from "../../domain/workspaces/repo";
import {
  GoogleOAuthError,
  type GoogleOAuthProvider,
  safeOAuthNext,
} from "../../infrastructure/auth/google_oauth";
import type { TrackEvent } from "../../application/activity/track_event";
import type { WriteAudit } from "../../application/audit/write_audit";
import type { AuthClient } from "../../application/auth/session";
import type { Clock } from "../../shared/clock";
import type { AppConfig } from "../../shared/config";
import {
  MAX_PASSWORD_LENGTH,
  RATE_LIMITS,
  REFRESH_TOKEN_TTL_DAYS,
} from "../../shared/constants";
import { AppError, validation } from "../../shared/errors";
import type { IdGenerator } from "../../shared/ids";
import { logEvent } from "../../shared/log";
import {
  enforceRateLimitScopes,
  normalizeRateLimitAddress,
  type RateLimiter,
} from "../../shared/ratelimit";
import {
  clearGoogleOAuthCookieHeader,
  clearRefreshCookieHeader,
  googleOAuthCookieHeader,
  readGoogleOAuthCookie,
  readRefreshCookie,
  refreshCookieHeader,
} from "../cookies";
import type { AppEnv } from "../env";
import { requireAuth } from "../middleware/auth";
import { presentUser } from "../presenters/user";
import { zjson } from "../validate";

export interface AuthRoutesDependencies {
  users: UserRepo;
  oauthIdentities: OAuthIdentityRepo;
  googleOAuth: Pick<
    GoogleOAuthProvider,
    | "createAuthorization"
    | "readAuthorizationState"
    | "completeAuthorization"
  >;
  legalAcceptances: LegalAcceptanceRepo;
  emailTokens: EmailTokenRepo;
  refreshTokens: RefreshTokenRepo;
  sessionSecurity: SessionSecurityRepo;
  workspaces: WorkspaceRepo;
  audit: Pick<WriteAudit, "execute">;
  track?: Pick<TrackEvent, "execute">;
  emailSender: EmailSender;
  rateLimiter: RateLimiter;
  clock: Clock;
  ids: IdGenerator;
  config: AppConfig;
}

const emailSchema = z.email();
const newPasswordSchema = z.string().superRefine((password, context) => {
  for (const message of newPasswordIssues(password)) {
    context.addIssue({
      code: "custom",
      message,
    });
  }
});

const registerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: emailSchema,
  password: newPasswordSchema,
  acceptedTerms: z.boolean().optional(),
  acceptedPrivacy: z.boolean().optional(),
  marketingOptIn: z.boolean().optional().default(false),
});
const emailInputSchema = z.object({ email: emailSchema });
const existingPasswordSchema = z
  .string()
  .min(1)
  // Login must accept every password that the Unicode-aware creation policy
  // can store; do not apply new-password strength/blocklist rules to existing
  // credentials.
  .refine(
    (password) => passwordCodePointLength(password) <= MAX_PASSWORD_LENGTH,
  );
const loginSchema = z.object({
  email: emailSchema,
  password: existingPasswordSchema,
});
const verifyEmailSchema = z.object({
  token: z.string().min(1).max(512),
  password: existingPasswordSchema,
});
const resetPasswordSchema = z.object({
  token: z.string().min(1).max(512),
  password: newPasswordSchema,
});

const GOOGLE_OAUTH_COOKIE_TTL_SECONDS = 10 * 60;
const GOOGLE_CALLBACK_PATH = "/api/auth/google/callback";

type GoogleRedirectError = "cancelled" | "failed" | "link_required";

function googleCallbackUrl(config: Pick<AppConfig, "appUrl">): string {
  return new URL(GOOGLE_CALLBACK_PATH, config.appUrl).toString();
}

function appDestination(
  config: Pick<AppConfig, "appUrl">,
  next: string,
): string {
  return new URL(safeOAuthNext(next), config.appUrl).toString();
}

function googleErrorDestination(
  config: Pick<AppConfig, "appUrl">,
  error: GoogleRedirectError,
  next: string,
): string {
  const destination = new URL("/signin", config.appUrl);
  destination.searchParams.set("oauth_error", error);
  const safeNext = safeOAuthNext(next);
  if (safeNext !== "/") destination.searchParams.set("next", safeNext);
  return destination.toString();
}

function googleFailureKind(error: unknown): GoogleRedirectError {
  if (
    error instanceof AppError &&
    (error.code === "INVALID_CREDENTIALS" || error.code === "CONFLICT")
  ) {
    return "link_required";
  }
  return "failed";
}

function googleFailureReason(error: unknown): string {
  if (error instanceof GoogleOAuthError) return error.code;
  if (error instanceof AppError) return `app_${error.code.toLowerCase()}`;
  return "unexpected";
}

function clientIp(context: { req: { header(name: string): string | undefined } }) {
  return normalizeRateLimitAddress(context.req.header("CF-Connecting-IP"));
}

async function privateScope(value: string): Promise<string> {
  return sha256Hex(value.trim().toLowerCase());
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

// Native apps (iOS) opt in with this header. They keep the refresh token in
// the device Keychain instead of a browser cookie, so the token travels in the
// JSON body and no Set-Cookie header is ever emitted for them. Browsers cannot
// send the header cross-origin: it is not in the CORS allow-list, so the
// preflight rejects it, and the cookie flow below stays byte-for-byte intact.
const NATIVE_CLIENT_HEADER = "X-Zenguy-Client";
const nativeRefreshSchema = z.object({
  refreshToken: z.string().min(1).max(512),
});
const nativeLogoutSchema = z.object({
  refreshToken: z.string().min(1).max(512).optional(),
});

function isNativeClient(context: Context<AppEnv>): boolean {
  return (
    context.req.header(NATIVE_CLIENT_HEADER)?.trim().toLowerCase() === "native"
  );
}

// Auth activity events record which first-party client acted as their source.
function clientKind(context: Context<AppEnv>): AuthClient {
  return isNativeClient(context) ? "app" : "web";
}

async function readNativeBody<T extends z.ZodType>(
  context: Context<AppEnv>,
  schema: T,
): Promise<z.infer<T>> {
  let raw: unknown = {};
  try {
    raw = await context.req.json();
  } catch {
    raw = {};
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw validation(
      parsed.error.issues.map((issue) => ({
        field: issue.path.map(String).join("."),
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}

function nativeSessionPayload(session: AuthSession, refreshMaxAge: number) {
  return {
    ...sessionPayload(session),
    refreshToken: session.refreshTokenPlain,
    refreshExpiresIn: refreshMaxAge,
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
  const googleLogin = new GoogleLogin(dependencies);
  const refresh = new Refresh(dependencies);
  const logout = new Logout(dependencies);
  const forgotPassword = new ForgotPassword(dependencies);
  const resetPassword = new ResetPassword(dependencies);
  const secureCookies = dependencies.config.environment !== "development";
  const refreshMaxAge = REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60;

  // Auth bodies and cookies are credentials, never cacheable application data.
  app.use("*", async (context, next) => {
    try {
      await next();
    } finally {
      // Keep the invariant on validation/auth/rate-limit failures too; those
      // responses can still reflect whether a submitted capability was live.
      context.header("Cache-Control", "no-store");
      context.header("Pragma", "no-cache");
    }
  });

  // Hands a session to the calling client: browsers get the refresh token as
  // an HttpOnly cookie, native apps get it in the JSON payload.
  function sessionResponse(context: Context<AppEnv>, session: AuthSession) {
    if (isNativeClient(context)) {
      return nativeSessionPayload(session, refreshMaxAge);
    }
    context.header(
      "Set-Cookie",
      refreshCookieHeader(
        session.refreshTokenPlain,
        refreshMaxAge,
        secureCookies,
      ),
    );
    return sessionPayload(session);
  }

  app.get("/google/start", async (context) => {
    context.header("Referrer-Policy", "no-referrer");
    const next = safeOAuthNext(context.req.query("next"));
    try {
      await enforceRateLimitScopes(
        dependencies.rateLimiter,
        [`google-start:ip:${await privateScope(clientIp(context))}`],
        RATE_LIMITS.login,
      );
      const authorization =
        await dependencies.googleOAuth.createAuthorization({
          redirectUri: googleCallbackUrl(dependencies.config),
          next,
        });
      context.header(
        "Set-Cookie",
        googleOAuthCookieHeader(
          authorization.stateCookie,
          GOOGLE_OAUTH_COOKIE_TTL_SECONDS,
          secureCookies,
        ),
      );
      return context.redirect(authorization.authorizationUrl, 302);
    } catch (error) {
      context.header(
        "Set-Cookie",
        clearGoogleOAuthCookieHeader(secureCookies),
      );
      logEvent("google_oauth_start_failed", {
        requestId: context.get("requestId"),
        reason: googleFailureReason(error),
      });
      return context.redirect(
        googleErrorDestination(dependencies.config, "failed", next),
        302,
      );
    }
  });

  app.get("/google/callback", async (context) => {
    context.header("Referrer-Policy", "no-referrer");
    const stateCookie = readGoogleOAuthCookie(context);
    context.header(
      "Set-Cookie",
      clearGoogleOAuthCookieHeader(secureCookies),
      { append: true },
    );

    let next = "/";
    try {
      await enforceRateLimitScopes(
        dependencies.rateLimiter,
        [`google-callback:ip:${await privateScope(clientIp(context))}`],
        RATE_LIMITS.login,
      );
      const returnedState = context.req.query("state") ?? "";
      if (stateCookie === null) {
        throw new GoogleOAuthError(
          "invalid_state",
          "Missing OAuth transaction cookie",
        );
      }
      const authorizationState =
        await dependencies.googleOAuth.readAuthorizationState({
          stateCookie,
          returnedState,
        });
      next = authorizationState.next;

      const providerError = context.req.query("error");
      if (providerError !== undefined) {
        const kind = providerError === "access_denied" ? "cancelled" : "failed";
        return context.redirect(
          googleErrorDestination(dependencies.config, kind, next),
          302,
        );
      }

      const code = context.req.query("code") ?? "";
      const identity = await dependencies.googleOAuth.completeAuthorization({
        redirectUri: googleCallbackUrl(dependencies.config),
        stateCookie,
        returnedState,
        code,
      });
      const session = await googleLogin.execute({ ...identity, client: "web" });
      context.header(
        "Set-Cookie",
        refreshCookieHeader(
          session.refreshTokenPlain,
          refreshMaxAge,
          secureCookies,
        ),
        { append: true },
      );
      return context.redirect(appDestination(dependencies.config, next), 302);
    } catch (error) {
      const kind = googleFailureKind(error);
      logEvent("google_oauth_failed", {
        requestId: context.get("requestId"),
        reason: googleFailureReason(error),
      });
      return context.redirect(
        googleErrorDestination(dependencies.config, kind, next),
        302,
      );
    }
  });

  app.post("/register", zjson(registerSchema), async (context) => {
    const input = context.req.valid("json");
    await enforceRateLimitScopes(
      dependencies.rateLimiter,
      [
        `register:ip:${await privateScope(clientIp(context))}`,
        `register:email:${await privateScope(input.email)}`,
      ],
      RATE_LIMITS.register,
    );
    const pending = await register.execute({
      ...input,
      client: clientKind(context),
    });
    return context.json({ data: pending }, 201);
  });

  app.post("/verify-email", zjson(verifyEmailSchema), async (context) => {
    const input = context.req.valid("json");
    await enforceRateLimitScopes(
      dependencies.rateLimiter,
      [
        `verify:ip:${await privateScope(clientIp(context))}`,
        `verify:token:${await sha256Hex(input.token)}`,
      ],
      RATE_LIMITS.verify_email,
    );
    const session = await verifyEmail.execute({
      ...input,
      client: clientKind(context),
    });
    return context.json({
      data: { verified: true, ...sessionResponse(context, session) },
    });
  });

  app.post(
    "/resend-verification",
    zjson(emailInputSchema),
    async (context) => {
      const input = context.req.valid("json");
      await enforceRateLimitScopes(
        dependencies.rateLimiter,
        [
          `resend:ip:${await privateScope(clientIp(context))}`,
          `resend:email:${await privateScope(input.email)}`,
        ],
        RATE_LIMITS.resend,
      );
      const result = await resendVerification.execute(input);
      return context.json({ data: result });
    },
  );

  app.post("/login", zjson(loginSchema), async (context) => {
    const input = context.req.valid("json");
    await enforceRateLimitScopes(
      dependencies.rateLimiter,
      [
        `login:ip:${await privateScope(clientIp(context))}`,
        `login:email:${await privateScope(input.email)}`,
      ],
      RATE_LIMITS.login,
    );
    const session = await login.execute({
      ...input,
      client: clientKind(context),
    });
    return context.json({ data: sessionResponse(context, session) });
  });

  app.post("/refresh", async (context) => {
    if (isNativeClient(context)) {
      const input = await readNativeBody(context, nativeRefreshSchema);
      const session = await refresh.execute({
        refreshTokenPlain: input.refreshToken,
      });
      return context.json({ data: sessionResponse(context, session) });
    }
    try {
      const refreshTokenPlain = readRefreshCookie(context);
      if (refreshTokenPlain === null) {
        throw new AppError(
          "UNAUTHORIZED",
          "Invalid or expired refresh token",
        );
      }
      const session = await refresh.execute({ refreshTokenPlain });
      return context.json({ data: sessionResponse(context, session) });
    } catch (error) {
      context.header("Set-Cookie", clearRefreshCookieHeader(secureCookies));
      throw error;
    }
  });

  app.post("/logout", async (context) => {
    if (isNativeClient(context)) {
      const input = await readNativeBody(context, nativeLogoutSchema);
      await logout.execute({
        refreshTokenPlain: input.refreshToken ?? null,
        client: clientKind(context),
      });
      return context.body(null, 204);
    }
    await logout.execute({
      refreshTokenPlain: readRefreshCookie(context),
      client: clientKind(context),
    });
    context.header("Set-Cookie", clearRefreshCookieHeader(secureCookies));
    return context.body(null, 204);
  });

  app.post(
    "/forgot-password",
    zjson(emailInputSchema),
    async (context) => {
      const input = context.req.valid("json");
      await enforceRateLimitScopes(
        dependencies.rateLimiter,
        [
          `forgot:ip:${await privateScope(clientIp(context))}`,
          `forgot:email:${await privateScope(input.email)}`,
        ],
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
      const input = context.req.valid("json");
      const ip = clientIp(context);
      // Both scopes run before ResetPassword can reach PBKDF2. The IP budget
      // stops random-token floods; the digest budget also contains a leaked
      // valid token when requests are distributed across source addresses.
      await enforceRateLimitScopes(
        dependencies.rateLimiter,
        [
          `reset:ip:${await privateScope(ip)}`,
          `reset:token:${await sha256Hex(input.token)}`,
        ],
        RATE_LIMITS.reset_password,
      );
      const result = await resetPassword.execute({ ...input, ip });
      return context.json({ data: result });
    },
  );

  app.get("/me", requireAuth(dependencies), (context) =>
    context.json({ data: { user: presentUser(context.get("user")) } }),
  );

  return app;
}
