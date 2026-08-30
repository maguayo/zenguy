import type { Hono } from "hono";
import { buildApp } from "../../app";
import type { User } from "../../domain/users/types";
import {
  GoogleOAuthError,
  type GoogleAuthorizationCompletionInput,
  type GoogleAuthorizationInput,
  type GoogleAuthorizationStateInput,
  type GoogleIdentityClaims,
} from "../../infrastructure/auth/google_oauth";
import { D1UserRepo } from "../../infrastructure/db/user_repo";
import { freshDb, freshKv, testEnv } from "../../test/helpers";
import type { AppEnv } from "../env";

const APP_URL = "https://staging-app.zenguy.com";
const STATE_COOKIE = "signed-google-transaction";
const RETURNED_STATE = "returned-google-state";

const VERIFIED_USER: User = {
  id: "usr_google_route",
  name: "Alice",
  email: "alice@example.com",
  passwordHash: "password-hash",
  emailVerifiedAt: 1_000,
  authVersion: 1,
  createdAt: 900,
  updatedAt: 1_000,
};

interface SessionResponse {
  data: {
    accessToken: string;
    expiresIn: number;
    user: {
      id: string;
      email: string;
      emailVerified: boolean;
    };
  };
}

class FakeGoogleOAuth {
  identity: GoogleIdentityClaims = {
    subject: "google-subject-route",
    email: VERIFIED_USER.email,
    name: VERIFIED_USER.name,
    hostedDomain: "example.com",
  };
  creationError: Error | null = null;
  completionError: Error | null = null;
  private next = "/";

  readonly createAuthorization = vi.fn(
    async (input: GoogleAuthorizationInput) => {
      if (this.creationError !== null) throw this.creationError;
      this.next = input.next;
      const authorizationUrl = new URL("https://accounts.google.test/authorize");
      authorizationUrl.searchParams.set("state", RETURNED_STATE);
      return {
        authorizationUrl: authorizationUrl.toString(),
        stateCookie: STATE_COOKIE,
      };
    },
  );

  readonly readAuthorizationState = vi.fn(
    async (input: GoogleAuthorizationStateInput) => {
      this.assertValidState(input);
      return { next: this.next };
    },
  );

  readonly completeAuthorization = vi.fn(
    async (input: GoogleAuthorizationCompletionInput) => {
      this.assertValidState(input);
      if (this.completionError !== null) throw this.completionError;
      return this.identity;
    },
  );

  private assertValidState(input: GoogleAuthorizationStateInput): void {
    if (
      input.stateCookie !== STATE_COOKIE ||
      input.returnedState !== RETURNED_STATE
    ) {
      throw new GoogleOAuthError("invalid_state", "Invalid OAuth state");
    }
  }
}

function setCookieHeaders(response: Response): string[] {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const separate = headers.getSetCookie?.() ?? [];
  if (separate.length > 0) return separate;
  const combined = response.headers.get("Set-Cookie");
  return combined === null
    ? []
    : combined.split(/,\s*(?=zenguy_(?:google_oauth|rt)=)/u);
}

function cookiePair(setCookie: string | undefined): string {
  if (setCookie === undefined) throw new Error("Expected Set-Cookie header");
  return setCookie.split(";", 1)[0] ?? "";
}

function findCookie(response: Response, name: string): string | undefined {
  return setCookieHeaders(response).find((value) =>
    value.startsWith(name + "="),
  );
}

async function startGoogle(
  app: Hono<AppEnv>,
  next: string,
): Promise<{
  cookie: string;
  response: Response;
  state: string;
}> {
  const query = new URLSearchParams({ next });
  const response = await app.request("/api/auth/google/start?" + query, {
    headers: { "CF-Connecting-IP": "198.51.100.20" },
  });
  const location = response.headers.get("Location");
  if (location === null) throw new Error("Expected Google redirect");
  const state = new URL(location).searchParams.get("state");
  if (state === null) throw new Error("Expected returned OAuth state");
  return {
    cookie: cookiePair(findCookie(response, "zenguy_google_oauth")),
    response,
    state,
  };
}

function callbackUrl(parameters: Record<string, string>): string {
  return "/api/auth/google/callback?" + new URLSearchParams(parameters);
}

function expectErrorRedirect(
  response: Response,
  error: "cancelled" | "failed" | "link_required",
  next: string | null,
): void {
  expect(response.status).toBe(302);
  const location = response.headers.get("Location");
  if (location === null) throw new Error("Expected application redirect");
  const destination = new URL(location);
  expect(destination.origin).toBe(APP_URL);
  expect(destination.pathname).toBe("/signin");
  expect(destination.searchParams.get("oauth_error")).toBe(error);
  expect(destination.searchParams.get("next")).toBe(next);
}

describe("Google OAuth routes", () => {
  let app: Hono<AppEnv>;
  let googleOAuth: FakeGoogleOAuth;

  beforeEach(async () => {
    await freshDb();
    await freshKv();
    googleOAuth = new FakeGoogleOAuth();
    app = buildApp(
      {
        ...testEnv(),
        APP_URL,
        ENVIRONMENT: "staging",
      },
      { googleOAuth },
    );
  });

  it("starts Google OAuth with a secure transaction cookie and sanitized next", async () => {
    const next = "/w/ws_1/overview?tab=runs";
    const started = await startGoogle(app, next);

    expect(started.response.status).toBe(302);
    expect(started.response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(started.response.headers.get("Cache-Control")).toBe("no-store");
    expect(findCookie(started.response, "zenguy_google_oauth")).toBe(
      started.cookie +
        "; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=600; Secure",
    );
    expect(googleOAuth.createAuthorization).toHaveBeenCalledWith({
      redirectUri: APP_URL + "/api/auth/google/callback",
      next,
    });
  });

  it("returns provider start failures to sign-in and clears stale state", async () => {
    googleOAuth.creationError = new GoogleOAuthError(
      "invalid_configuration",
      "Provider is not configured",
    );
    const response = await app.request(
      "/api/auth/google/start?" +
        new URLSearchParams({ next: "/w/ws_1/overview" }),
      { headers: { "CF-Connecting-IP": "198.51.100.27" } },
    );

    expectErrorRedirect(response, "failed", "/w/ws_1/overview");
    expect(findCookie(response, "zenguy_google_oauth")).toBe(
      "zenguy_google_oauth=; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=0; Secure",
    );
  });

  it("completes the callback, clears state, sets refresh, and authenticates refresh", async () => {
    await new D1UserRepo(testEnv().DB).insert(VERIFIED_USER);
    const next = "/w/ws_1/overview?tab=runs";
    const started = await startGoogle(app, next);

    const callback = await app.request(
      callbackUrl({ code: "authorization-code", state: started.state }),
      {
        headers: {
          Cookie: started.cookie,
          "CF-Connecting-IP": "198.51.100.21",
        },
      },
    );

    expect(callback.status).toBe(302);
    expect(callback.headers.get("Location")).toBe(APP_URL + next);
    expect(callback.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(callback.headers.get("Cache-Control")).toBe("no-store");
    expect(findCookie(callback, "zenguy_google_oauth")).toBe(
      "zenguy_google_oauth=; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=0; Secure",
    );
    const refreshSetCookie = findCookie(callback, "zenguy_rt");
    expect(refreshSetCookie).toMatch(
      /^zenguy_rt=[A-Za-z0-9_-]+; Path=\/api\/auth; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure$/u,
    );

    const refreshed = await app.request("/api/auth/refresh", {
      method: "POST",
      headers: { Cookie: cookiePair(refreshSetCookie) },
    });
    expect(refreshed.status).toBe(200);
    await expect(refreshed.json()).resolves.toMatchObject({
      data: {
        accessToken: expect.any(String),
        expiresIn: 1_800,
        user: {
          id: VERIFIED_USER.id,
          email: VERIFIED_USER.email,
          emailVerified: true,
        },
      },
    } satisfies SessionResponse);
  });

  it("maps access_denied to cancelled only after validating state", async () => {
    const next = "/invitations/accept";
    const started = await startGoogle(app, next);

    const cancelled = await app.request(
      callbackUrl({ error: "access_denied", state: started.state }),
      {
        headers: {
          Cookie: started.cookie,
          "CF-Connecting-IP": "198.51.100.22",
        },
      },
    );

    expectErrorRedirect(cancelled, "cancelled", next);
    expect(googleOAuth.completeAuthorization).not.toHaveBeenCalled();
  });

  it("maps invalid state to failed without trusting its stored or query next", async () => {
    const started = await startGoogle(app, "/w/private/overview");

    const invalid = await app.request(
      callbackUrl({
        error: "access_denied",
        next: "//evil.example/steal",
        state: "attacker-state",
      }),
      {
        headers: {
          Cookie: started.cookie,
          "CF-Connecting-IP": "198.51.100.23",
        },
      },
    );

    expectErrorRedirect(invalid, "failed", null);
    expect(findCookie(invalid, "zenguy_google_oauth")).toContain("Max-Age=0");
    expect(googleOAuth.completeAuthorization).not.toHaveBeenCalled();
  });

  it("maps an unknown account to link_required without setting refresh", async () => {
    googleOAuth.identity = {
      subject: "google-subject-unknown",
      email: "unknown@example.com",
      name: "Unknown",
      hostedDomain: "example.com",
    };
    const next = "/invitations/accept";
    const started = await startGoogle(app, next);

    const callback = await app.request(
      callbackUrl({ code: "authorization-code", state: started.state }),
      {
        headers: {
          Cookie: started.cookie,
          "CF-Connecting-IP": "198.51.100.24",
        },
      },
    );

    expectErrorRedirect(callback, "link_required", next);
    expect(findCookie(callback, "zenguy_google_oauth")).toContain("Max-Age=0");
    expect(findCookie(callback, "zenguy_rt")).toBeUndefined();
  });

  it("maps provider failures to failed after preserving a validated next", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    googleOAuth.completionError = new GoogleOAuthError(
      "token_exchange_failed",
      "Provider unavailable: authorization-code-sensitive client-secret-sensitive",
      "token_exchange_rejected_invalid_grant",
    );
    const next = "/grants/redeem";
    const started = await startGoogle(app, next);

    const callback = await app.request(
      callbackUrl({ code: "authorization-code", state: started.state }),
      {
        headers: {
          Cookie: started.cookie,
          "CF-Connecting-IP": "198.51.100.25",
        },
      },
    );

    expectErrorRedirect(callback, "failed", next);
    expect(findCookie(callback, "zenguy_rt")).toBeUndefined();

    const oauthFailure = log.mock.calls
      .map(([value]) =>
        typeof value === "string"
          ? (JSON.parse(value) as Record<string, unknown>)
          : {},
      )
      .find((entry) => entry.event === "google_oauth_failed");
    expect(oauthFailure).toMatchObject({
      event: "google_oauth_failed",
      reason: "token_exchange_failed",
      diagnostic: "token_exchange_rejected_invalid_grant",
      requestId: expect.any(String),
      t: expect.any(Number),
    });
    expect(Object.keys(oauthFailure ?? {}).sort()).toEqual(
      ["diagnostic", "event", "reason", "requestId", "t"].sort(),
    );
    expect(JSON.stringify(oauthFailure)).not.toContain(
      "authorization-code-sensitive",
    );
    expect(JSON.stringify(oauthFailure)).not.toContain(
      "client-secret-sensitive",
    );
    log.mockRestore();
  });

  it("blocks an open redirect throughout start and callback", async () => {
    await new D1UserRepo(testEnv().DB).insert(VERIFIED_USER);
    const started = await startGoogle(app, "//evil.example/steal");
    expect(googleOAuth.createAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({ next: "/" }),
    );

    const callback = await app.request(
      callbackUrl({ code: "authorization-code", state: started.state }),
      {
        headers: {
          Cookie: started.cookie,
          "CF-Connecting-IP": "198.51.100.26",
        },
      },
    );

    expect(callback.status).toBe(302);
    expect(callback.headers.get("Location")).toBe(APP_URL + "/");
    expect(callback.headers.get("Location")).not.toContain("evil.example");
  });
});
