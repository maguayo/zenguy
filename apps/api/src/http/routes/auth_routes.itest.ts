import type { Hono } from "hono";
import { buildApp } from "../../app";
import { D1UserRepo } from "../../infrastructure/db/user_repo";
import { loadConfig } from "../../shared/config";
import { RATE_LIMITS, REFRESH_REUSE_GRACE_MS } from "../../shared/constants";
import { sha256Hex } from "../../shared/crypto";
import { freshDb, freshKv, testEnv } from "../../test/helpers";
import { RecordingEmailSender } from "../../test/fakes/email";
import type { AppEnv } from "../env";
import { requireAuth, requireVerifiedEmail } from "../middleware/auth";

interface SessionResponse {
  data: {
    user: {
      id: string;
      name: string;
      email: string;
      emailVerified: boolean;
      createdAt: string;
    };
    accessToken: string;
    expiresIn: number;
  };
}

interface NativeSessionResponse {
  data: SessionResponse["data"] & {
    refreshToken: string;
    refreshExpiresIn: number;
  };
}

interface RegistrationPendingResponse {
  data: {
    registrationPending: true;
    email: string;
  };
}

function jsonRequest(body: object, headers: HeadersInit = {}): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}

function cookiePair(setCookie: string | null): string {
  if (setCookie === null) throw new Error("Expected Set-Cookie header");
  return setCookie.split(";", 1)[0] ?? "";
}

function tokenFromMessage(text: string | undefined): string {
  const url = text?.match(/https?:\/\/\S+/u)?.[0];
  if (url === undefined) throw new Error("Expected token URL in email");
  const token = new URL(url).hash.slice(1);
  if (token === "") throw new Error("Expected token URL fragment");
  return decodeURIComponent(token);
}

async function registerUser(
  app: Hono<AppEnv>,
  ip: string,
  input: {
    name?: string;
    email?: string;
    password?: string;
    acceptedPrivacy?: boolean;
    acceptedTerms?: boolean;
    marketingOptIn?: boolean;
  } = {},
): Promise<Response> {
  return app.request(
    "/api/auth/register",
    jsonRequest(
      {
        name: "Alice",
        email: "alice@example.com",
        password: "initial-password",
        acceptedPrivacy: true,
        acceptedTerms: true,
        marketingOptIn: false,
        ...input,
      },
      { "CF-Connecting-IP": ip },
    ),
  );
}

describe("auth routes", () => {
  let emails: RecordingEmailSender;
  let app: Hono<AppEnv>;

  beforeEach(async () => {
    await freshDb();
    await freshKv();
    emails = new RecordingEmailSender();
    app = buildApp(testEnv(), { emailSender: emails });
  });

  it("completes register, verify, login, me, refresh, and logout", async () => {
    const registerResponse = await registerUser(app, "198.51.100.10");
    expect(registerResponse.status).toBe(201);
    expect(registerResponse.headers.get("Cache-Control")).toBe("no-store");
    const registered =
      (await registerResponse.json()) as RegistrationPendingResponse;
    expect(registered.data).toEqual({
      registrationPending: true,
      email: "alice@example.com",
    });
    expect(registered.data).not.toHaveProperty("accessToken");
    expect(registered.data).not.toHaveProperty("refreshToken");
    expect(registerResponse.headers.get("Set-Cookie")).toBeNull();

    const verificationToken = tokenFromMessage(emails.messages[0]?.text);
    const verifyResponse = await app.request(
      "/api/auth/verify-email",
      jsonRequest({
        token: verificationToken,
        password: "initial-password",
      }),
    );
    expect(verifyResponse.status).toBe(200);
    expect(verifyResponse.headers.get("Cache-Control")).toBe("no-store");
    // The inbox link and registration password jointly activate the account;
    // the device that proves both receives the new verified session.
    const verified = (await verifyResponse.json()) as SessionResponse & {
      data: { verified: boolean };
    };
    expect(verified.data).toMatchObject({
      verified: true,
      expiresIn: 1_800,
      user: { email: "alice@example.com", emailVerified: true },
    });
    expect(verifyResponse.headers.get("Set-Cookie")).toMatch(
      /^zenguy_rt=[A-Za-z0-9_-]+; Path=\/api\/auth; HttpOnly; SameSite=Lax; Max-Age=2592000$/u,
    );
    const verifiedMe = await app.request("/api/auth/me", {
      headers: { Authorization: `Bearer ${verified.data.accessToken}` },
    });
    expect(verifiedMe.status).toBe(200);
    await expect(verifiedMe.json()).resolves.toMatchObject({
      data: { user: { email: "alice@example.com", emailVerified: true } },
    });

    const loginResponse = await app.request(
      "/api/auth/login",
      jsonRequest(
        { email: "alice@example.com", password: "initial-password" },
        { "CF-Connecting-IP": "198.51.100.11" },
      ),
    );
    expect(loginResponse.status).toBe(200);
    expect(loginResponse.headers.get("Cache-Control")).toBe("no-store");
    const login = (await loginResponse.json()) as SessionResponse;
    expect(login.data.user.emailVerified).toBe(true);
    expect(login.data.expiresIn).toBe(1_800);
    const loginCookieHeader = loginResponse.headers.get("Set-Cookie");
    expect(loginCookieHeader).toMatch(
      /^zenguy_rt=[A-Za-z0-9_-]+; Path=\/api\/auth; HttpOnly; SameSite=Lax; Max-Age=2592000$/u,
    );
    const firstCookie = cookiePair(loginCookieHeader);
    expect(firstCookie).toMatch(/^zenguy_rt=\S+$/u);

    const meResponse = await app.request("/api/auth/me", {
      headers: { Authorization: `Bearer ${login.data.accessToken}` },
    });
    expect(meResponse.status).toBe(200);
    await expect(meResponse.json()).resolves.toMatchObject({
      data: { user: { email: "alice@example.com", emailVerified: true } },
    });

    const refreshResponse = await app.request("/api/auth/refresh", {
      method: "POST",
      headers: { Cookie: firstCookie },
    });
    expect(refreshResponse.status).toBe(200);
    expect(refreshResponse.headers.get("Cache-Control")).toBe("no-store");
    const refreshed = (await refreshResponse.json()) as SessionResponse;
    expect(refreshed.data.accessToken).toEqual(expect.any(String));
    const refreshCookie = refreshResponse.headers.get("Set-Cookie");
    expect(refreshCookie).toMatch(
      /^zenguy_rt=[A-Za-z0-9_-]+; Path=\/api\/auth; HttpOnly; SameSite=Lax; Max-Age=2592000$/u,
    );
    const rotatedCookie = cookiePair(refreshCookie);
    expect(rotatedCookie).not.toBe(firstCookie);

    const logoutResponse = await app.request("/api/auth/logout", {
      method: "POST",
      headers: { Cookie: rotatedCookie },
    });
    expect(logoutResponse.status).toBe(204);
    expect(logoutResponse.headers.get("Cache-Control")).toBe("no-store");
    expect(await logoutResponse.text()).toBe("");
    expect(logoutResponse.headers.get("Set-Cookie")).toBe(
      "zenguy_rt=; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=0",
    );
    const accessAfterLogout = await app.request("/api/auth/me", {
      headers: { Authorization: `Bearer ${login.data.accessToken}` },
    });
    expect(accessAfterLogout.status).toBe(401);
    const refreshAfterLogout = await app.request("/api/auth/refresh", {
      method: "POST",
      headers: { Cookie: firstCookie },
    });
    expect(refreshAfterLogout.status).toBe(401);
  });

  it("does not reveal whether a registration email already exists", async () => {
    const first = await registerUser(app, "198.51.100.14");
    const firstBody = await first.json();
    emails.messages.length = 0;
    const duplicate = await registerUser(app, "198.51.100.15", {
      name: "Different display name",
      email: "ALICE@EXAMPLE.COM",
      password: "different-password",
    });

    expect(duplicate.status).toBe(first.status);
    const body = (await duplicate.json()) as RegistrationPendingResponse;
    expect(body).toEqual(firstBody);
    expect(body.data).toEqual({
      registrationPending: true,
      email: "alice@example.com",
    });
    expect(duplicate.headers.get("Set-Cookie")).toBeNull();
    expect(emails.messages).toHaveLength(1);
    expect(emails.messages[0]?.subject).toBe(
      "A registration attempt used your email — Zenguy",
    );
  });

  it("prevents verification-link pre-account takeover without consuming either factor", async () => {
    const originalPassword = "attacker-chosen-password";
    const registerResponse = await registerUser(app, "198.51.100.160", {
      name: "Mailbox Victim",
      email: "victim@example.com",
      password: originalPassword,
    });
    expect(registerResponse.status).toBe(201);
    const verificationToken = tokenFromMessage(emails.messages[0]?.text);

    // Knowing the password chosen in an unsolicited registration is not
    // enough without the inbox capability.
    const passwordOnly = await app.request(
      "/api/auth/verify-email",
      jsonRequest(
        { token: "not-the-inbox-token", password: originalPassword },
        { "CF-Connecting-IP": "198.51.100.161" },
      ),
    );
    expect(passwordOnly.status).toBe(410);

    // Conversely, opening the victim's real link cannot bless the password
    // selected by somebody else. A failed password must leave the token live.
    const tokenOnly = await app.request(
      "/api/auth/verify-email",
      jsonRequest(
        { token: verificationToken, password: "victim-does-not-know-it" },
        { "CF-Connecting-IP": "198.51.100.162" },
      ),
    );
    expect(tokenOnly.status).toBe(401);
    await expect(tokenOnly.json()).resolves.toEqual({
      error: { code: "INVALID_CREDENTIALS", message: "Incorrect password" },
    });
    const users = new D1UserRepo(testEnv().DB);
    await expect(users.findByEmail("victim@example.com")).resolves.toMatchObject({
      emailVerifiedAt: null,
    });

    // The legitimate pair remains usable, proving the wrong-password request
    // did not consume or invalidate the single-use link.
    const bothFactors = await app.request(
      "/api/auth/verify-email",
      jsonRequest(
        { token: verificationToken, password: originalPassword },
        { "CF-Connecting-IP": "198.51.100.163" },
      ),
    );
    expect(bothFactors.status).toBe(200);
    await expect(users.findByEmail("victim@example.com")).resolves.toMatchObject({
      emailVerifiedAt: expect.any(Number),
    });
  });

  it("makes unknown-account and wrong-password login responses indistinguishable", async () => {
    await registerUser(app, "198.51.100.16");
    const wrongPassword = await app.request(
      "/api/auth/login",
      jsonRequest(
        { email: "alice@example.com", password: "not-the-password" },
        { "CF-Connecting-IP": "198.51.100.17" },
      ),
    );
    const unknownAccount = await app.request(
      "/api/auth/login",
      jsonRequest(
        { email: "missing@example.com", password: "not-the-password" },
        { "CF-Connecting-IP": "198.51.100.18" },
      ),
    );

    expect(unknownAccount.status).toBe(wrongPassword.status);
    expect(unknownAccount.headers.get("Cache-Control")).toBe(
      wrongPassword.headers.get("Cache-Control"),
    );
    expect(unknownAccount.headers.get("Set-Cookie")).toBeNull();
    expect(await unknownAccount.json()).toEqual(await wrongPassword.json());
  });

  it("uses secure refresh cookies throughout the staging session lifecycle", async () => {
    const stagingEnv = {
      ...testEnv(),
      ENVIRONMENT: "staging",
      APP_URL: "https://staging-app.zenguy.com",
    };
    const stagingApp = buildApp(stagingEnv, { emailSender: emails });
    await registerUser(stagingApp, "198.51.100.12");

    const loginResponse = await stagingApp.request(
      "/api/auth/login",
      jsonRequest(
        { email: "alice@example.com", password: "initial-password" },
        { "CF-Connecting-IP": "198.51.100.13" },
      ),
    );
    expect(loginResponse.status).toBe(200);
    const loginCookie = loginResponse.headers.get("Set-Cookie");
    expect(loginCookie).toMatch(
      /^zenguy_rt=[A-Za-z0-9_-]+; Path=\/api\/auth; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure$/u,
    );

    const refreshResponse = await stagingApp.request("/api/auth/refresh", {
      method: "POST",
      headers: { Cookie: cookiePair(loginCookie) },
    });
    expect(refreshResponse.status).toBe(200);
    const refreshCookie = refreshResponse.headers.get("Set-Cookie");
    expect(refreshCookie).toMatch(
      /^zenguy_rt=[A-Za-z0-9_-]+; Path=\/api\/auth; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure$/u,
    );

    const logoutResponse = await stagingApp.request("/api/auth/logout", {
      method: "POST",
      headers: { Cookie: cookiePair(refreshCookie) },
    });
    expect(logoutResponse.status).toBe(204);
    expect(logoutResponse.headers.get("Set-Cookie")).toBe(
      "zenguy_rt=; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=0; Secure",
    );
  });

  it("returns the same 401 for a wrong password and missing bearer token", async () => {
    await registerUser(app, "198.51.100.20");
    const wrongPassword = await app.request(
      "/api/auth/login",
      jsonRequest(
        { email: "alice@example.com", password: "wrong-password" },
        { "CF-Connecting-IP": "198.51.100.21" },
      ),
    );
    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.headers.get("Cache-Control")).toBe("no-store");
    await expect(wrongPassword.json()).resolves.toEqual({
      error: {
        code: "INVALID_CREDENTIALS",
        message: "Incorrect email or password",
      },
    });

    const missingBearer = await app.request("/api/auth/me");
    expect(missingBearer.status).toBe(401);
    await expect(missingBearer.json()).resolves.toMatchObject({
      error: { code: "UNAUTHORIZED" },
    });
  });

  it("returns validation details and enforces reset password length", async () => {
    const response = await app.request(
      "/api/auth/register",
      jsonRequest({ name: "", email: "not-an-email", password: "short" }),
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = (await response.json()) as {
      error: { code: string; details: { field: string }[] };
    };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details.map((detail) => detail.field)).toEqual(
      expect.arrayContaining(["name", "email", "password"]),
    );

    const resetResponse = await app.request(
      "/api/auth/reset-password",
      jsonRequest({ token: "token", password: "short" }),
    );
    expect(resetResponse.status).toBe(400);
    await expect(resetResponse.json()).resolves.toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        details: [{ field: "password" }],
      },
    });
  });

  it("uses Unicode code points consistently for password creation and login", async () => {
    const password = "😀".repeat(60);
    const registered = await registerUser(app, "198.51.100.22", {
      name: "Unicode Password",
      email: "unicode-password@example.com",
      password,
    });
    expect(registered.status).toBe(201);

    const login = await app.request(
      "/api/auth/login",
      jsonRequest(
        { email: "unicode-password@example.com", password },
        { "CF-Connecting-IP": "198.51.100.23" },
      ),
    );
    expect(login.status).toBe(200);

    const oversized = await app.request(
      "/api/auth/login",
      jsonRequest(
        {
          email: "unicode-password@example.com",
          password: "😀".repeat(101),
        },
        { "CF-Connecting-IP": "198.51.100.24" },
      ),
    );
    expect(oversized.status).toBe(400);
  });

  it("rate limits login by IP after the configured allowance", async () => {
    const ip = "198.51.100.30";
    for (let attempt = 0; attempt < RATE_LIMITS.login.limit; attempt += 1) {
      const response = await app.request(
        "/api/auth/login",
        jsonRequest(
          { email: "unknown@example.com", password: "wrong-password" },
          { "CF-Connecting-IP": ip },
        ),
      );
      expect(response.status).toBe(401);
    }

    const limited = await app.request(
      "/api/auth/login",
      jsonRequest(
        { email: "other@example.com", password: "wrong-password" },
        { "CF-Connecting-IP": ip },
      ),
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toMatch(/^\d+$/u);
    await expect(limited.json()).resolves.toEqual({
      error: { code: "RATE_LIMITED", message: "Too many requests" },
    });
  });

  it("rate limits email verification by both source IP and token digest", async () => {
    const sharedToken = "unknown-shared-verification-token";
    for (
      let attempt = 0;
      attempt < RATE_LIMITS.verify_email.limit;
      attempt += 1
    ) {
      const response = await app.request(
        "/api/auth/verify-email",
        jsonRequest(
          { token: sharedToken, password: "candidate-password" },
          { "CF-Connecting-IP": `198.51.100.${170 + attempt}` },
        ),
      );
      expect(response.status).toBe(410);
    }
    const tokenLimited = await app.request(
      "/api/auth/verify-email",
      jsonRequest(
        { token: sharedToken, password: "candidate-password" },
        { "CF-Connecting-IP": "198.51.100.180" },
      ),
    );
    expect(tokenLimited.status).toBe(429);

    const sharedIp = "198.51.100.181";
    for (
      let attempt = 0;
      attempt < RATE_LIMITS.verify_email.limit;
      attempt += 1
    ) {
      const response = await app.request(
        "/api/auth/verify-email",
        jsonRequest(
          {
            token: `unknown-verification-token-${attempt}`,
            password: "candidate-password",
          },
          { "CF-Connecting-IP": sharedIp },
        ),
      );
      expect(response.status).toBe(410);
    }
    const ipLimited = await app.request(
      "/api/auth/verify-email",
      jsonRequest(
        { token: "one-more-token", password: "candidate-password" },
        { "CF-Connecting-IP": sharedIp },
      ),
    );
    expect(ipLimited.status).toBe(429);
    expect(ipLimited.headers.get("Retry-After")).toMatch(/^\d+$/u);
  });

  it("rate limits login by normalized email across different IPs", async () => {
    const email = "email-scope@example.com";
    for (let attempt = 0; attempt < RATE_LIMITS.login.limit; attempt += 1) {
      const response = await app.request(
        "/api/auth/login",
        jsonRequest(
          { email, password: "wrong-password" },
          { "CF-Connecting-IP": `198.51.100.${80 + attempt}` },
        ),
      );
      expect(response.status).toBe(401);
    }

    const limited = await app.request(
      "/api/auth/login",
      jsonRequest(
        { email: email.toUpperCase(), password: "wrong-password" },
        { "CF-Connecting-IP": "198.51.100.100" },
      ),
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toMatch(/^\d+$/u);
    await expect(limited.json()).resolves.toEqual({
      error: { code: "RATE_LIMITED", message: "Too many requests" },
    });
  });

  it("stores auth rate scopes as digests rather than submitted identifiers", async () => {
    const email = "private-rate-scope@example.com";
    const ip = "198.51.100.222";
    await app.request(
      "/api/auth/login",
      jsonRequest(
        { email, password: "wrong-password" },
        { "CF-Connecting-IP": ip },
      ),
    );

    const rows = await testEnv().DB.prepare(
      "SELECT rate_key FROM rate_limit_windows ORDER BY rate_key ASC",
    ).all<{ rate_key: string }>();
    expect(rows.results.map((row) => row.rate_key)).toEqual([
      `login:email:${await sha256Hex(email)}`,
      `login:ip:${await sha256Hex(ip)}`,
    ]);
    expect(JSON.stringify(rows.results)).not.toContain(email);
    expect(JSON.stringify(rows.results)).not.toContain(ip);
  });

  it("rate limits register, forgot-password, and resend-verification", async () => {
    const registerIp = "198.51.100.31";
    for (let attempt = 0; attempt < RATE_LIMITS.register.limit; attempt += 1) {
      const response = await registerUser(app, registerIp, {
        name: `Registrant ${attempt}`,
        email: `registrant-${attempt}@example.com`,
        password: "initial-password",
      });
      expect(response.status).toBe(201);
    }
    const limitedRegister = await registerUser(app, registerIp, {
      name: "Limited Registrant",
      email: "limited-registrant@example.com",
      password: "initial-password",
    });
    expect(limitedRegister.status).toBe(429);
    expect(limitedRegister.headers.get("Retry-After")).toMatch(/^\d+$/u);

    for (const flow of [
      {
        path: "/api/auth/forgot-password",
        email: "forgot-limit@example.com",
        rate: RATE_LIMITS.forgot,
      },
      {
        path: "/api/auth/resend-verification",
        email: "resend-limit@example.com",
        rate: RATE_LIMITS.resend,
      },
    ] as const) {
      for (let attempt = 0; attempt < flow.rate.limit; attempt += 1) {
        const response = await app.request(
          flow.path,
          jsonRequest({ email: flow.email }),
        );
        expect(response.status).toBe(200);
      }
      const limited = await app.request(
        flow.path,
        jsonRequest({ email: flow.email.toUpperCase() }),
      );
      expect(limited.status).toBe(429);
      expect(limited.headers.get("Retry-After")).toMatch(/^\d+$/u);
      await expect(limited.json()).resolves.toEqual({
        error: { code: "RATE_LIMITED", message: "Too many requests" },
      });
    }
  });

  it("blocks an unverified user at the reusable verified-email gate", async () => {
    const bindings = testEnv();
    const users = new D1UserRepo(bindings.DB);
    app.get(
      "/api/_protected",
      requireAuth({ users, config: loadConfig(bindings) }),
      requireVerifiedEmail,
      (context) => context.json({ data: { allowed: true } }),
    );
    await registerUser(app, "198.51.100.40");
    const loginResponse = await app.request(
      "/api/auth/login",
      jsonRequest(
        { email: "alice@example.com", password: "initial-password" },
        { "CF-Connecting-IP": "198.51.100.41" },
      ),
    );
    const login = (await loginResponse.json()) as SessionResponse;

    const protectedResponse = await app.request("/api/_protected", {
      headers: { Authorization: `Bearer ${login.data.accessToken}` },
    });
    expect(protectedResponse.status).toBe(403);
    await expect(protectedResponse.json()).resolves.toEqual({
      error: {
        code: "EMAIL_NOT_VERIFIED",
        message: "Verify your email to continue",
      },
    });
  });

  it("rate limits password reset by IP before handling random tokens", async () => {
    const ip = "198.51.100.31";
    for (
      let attempt = 0;
      attempt < RATE_LIMITS.reset_password.limit;
      attempt += 1
    ) {
      const response = await app.request(
        "/api/auth/reset-password",
        jsonRequest(
          {
            token: `unknown-reset-token-${attempt}`,
            password: "replacement-password",
          },
          { "CF-Connecting-IP": ip },
        ),
      );
      expect(response.status).toBe(410);
    }

    const limited = await app.request(
      "/api/auth/reset-password",
      jsonRequest(
        {
          token: "another-unknown-reset-token",
          password: "replacement-password",
        },
        { "CF-Connecting-IP": ip },
      ),
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toMatch(/^\d+$/u);
    expect(limited.headers.get("Cache-Control")).toBe("no-store");
  });

  it("rate limits one reset capability across source addresses", async () => {
    const token = "shared-unknown-reset-token";
    for (
      let attempt = 0;
      attempt < RATE_LIMITS.reset_password.limit;
      attempt += 1
    ) {
      const response = await app.request(
        "/api/auth/reset-password",
        jsonRequest(
          { token, password: "replacement-password" },
          { "CF-Connecting-IP": `198.51.100.${100 + attempt}` },
        ),
      );
      expect(response.status).toBe(410);
    }

    const limited = await app.request(
      "/api/auth/reset-password",
      jsonRequest(
        { token, password: "replacement-password" },
        { "CF-Connecting-IP": "198.51.100.200" },
      ),
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toMatch(/^\d+$/u);
  });

  it("supports quiet resend/forgot flows and revokes sessions on reset", async () => {
    await expect(
      app.request(
        "/api/auth/resend-verification",
        jsonRequest(
          { email: "unknown@example.com" },
          { "CF-Connecting-IP": "198.51.100.50" },
        ),
      ),
    ).resolves.toMatchObject({ status: 200 });
    await expect(
      app.request(
        "/api/auth/forgot-password",
        jsonRequest(
          { email: "unknown@example.com" },
          { "CF-Connecting-IP": "198.51.100.51" },
        ),
      ),
    ).resolves.toMatchObject({ status: 200 });

    await registerUser(app, "198.51.100.52");
    const loginResponse = await app.request(
      "/api/auth/login",
      jsonRequest(
        { email: "alice@example.com", password: "initial-password" },
        { "CF-Connecting-IP": "198.51.100.53" },
      ),
    );
    const oldAccess = ((await loginResponse.clone().json()) as SessionResponse)
      .data.accessToken;
    const oldCookie = cookiePair(loginResponse.headers.get("Set-Cookie"));
    const forgotResponse = await app.request(
      "/api/auth/forgot-password",
      jsonRequest(
        { email: "alice@example.com" },
        { "CF-Connecting-IP": "198.51.100.54" },
      ),
    );
    expect(forgotResponse.status).toBe(200);
    const resetToken = tokenFromMessage(emails.messages.at(-1)?.text);
    const resetResponse = await app.request(
      "/api/auth/reset-password",
      jsonRequest({ token: resetToken, password: "replacement-password" }),
    );
    expect(resetResponse.status).toBe(200);
    expect(resetResponse.headers.get("Cache-Control")).toBe("no-store");

    const staleAccess = await app.request("/api/auth/me", {
      headers: { Authorization: `Bearer ${oldAccess}` },
    });
    expect(staleAccess.status).toBe(401);

    const staleRefresh = await app.request("/api/auth/refresh", {
      method: "POST",
      headers: { Cookie: oldCookie },
    });
    expect(staleRefresh.status).toBe(401);
    expect(staleRefresh.headers.get("Set-Cookie")).toContain("Max-Age=0");

    const replacementLogin = await app.request(
      "/api/auth/login",
      jsonRequest(
        { email: "alice@example.com", password: "replacement-password" },
        { "CF-Connecting-IP": "198.51.100.55" },
      ),
    );
    expect(replacementLogin.status).toBe(200);
  });

  it("serves native clients with body refresh tokens and no cookies", async () => {
    const native = {
      "X-Zenguy-Client": "native",
      "CF-Connecting-IP": "198.51.100.41",
    };
    const registerResponse = await app.request(
      "/api/auth/register",
      jsonRequest(
        {
          name: "Alice",
          email: "alice@example.com",
          password: "initial-password",
          acceptedPrivacy: true,
          acceptedTerms: true,
          marketingOptIn: false,
        },
        { ...native, "CF-Connecting-IP": "198.51.100.40" },
      ),
    );
    expect(registerResponse.status).toBe(201);
    expect(registerResponse.headers.get("Set-Cookie")).toBeNull();
    const registered =
      (await registerResponse.json()) as RegistrationPendingResponse;
    expect(registered.data).toEqual({
      registrationPending: true,
      email: "alice@example.com",
    });

    const verifyResponse = await app.request(
      "/api/auth/verify-email",
      jsonRequest(
        {
          token: tokenFromMessage(emails.messages[0]?.text),
          password: "initial-password",
        },
        native,
      ),
    );
    expect(verifyResponse.status).toBe(200);
    expect(verifyResponse.headers.get("Set-Cookie")).toBeNull();
    const verified = (await verifyResponse.json()) as NativeSessionResponse;
    expect(verified.data.user.emailVerified).toBe(true);
    expect(verified.data.refreshToken).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(verified.data.refreshExpiresIn).toBe(2_592_000);

    const loginResponse = await app.request(
      "/api/auth/login",
      jsonRequest(
        { email: "alice@example.com", password: "initial-password" },
        native,
      ),
    );
    expect(loginResponse.status).toBe(200);
    expect(loginResponse.headers.get("Set-Cookie")).toBeNull();
    const login = (await loginResponse.json()) as NativeSessionResponse;
    expect(login.data.user.email).toBe("alice@example.com");
    expect(login.data.accessToken).toEqual(expect.any(String));
    expect(login.data.expiresIn).toBe(1_800);
    expect(login.data.refreshToken).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(login.data.refreshExpiresIn).toBe(2_592_000);

    const meResponse = await app.request("/api/auth/me", {
      headers: { Authorization: `Bearer ${login.data.accessToken}` },
    });
    expect(meResponse.status).toBe(200);

    const refreshResponse = await app.request(
      "/api/auth/refresh",
      jsonRequest({ refreshToken: login.data.refreshToken }, native),
    );
    expect(refreshResponse.status).toBe(200);
    expect(refreshResponse.headers.get("Set-Cookie")).toBeNull();
    const refreshed = (await refreshResponse.json()) as NativeSessionResponse;
    expect(refreshed.data.accessToken).toEqual(expect.any(String));
    expect(refreshed.data.refreshToken).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(refreshed.data.refreshToken).not.toBe(login.data.refreshToken);

    // Rotation race: presenting the just-replaced token within the grace
    // window continues from the head of the chain (a retry after a lost
    // response), so the family survives.
    const graced = await app.request(
      "/api/auth/refresh",
      jsonRequest({ refreshToken: login.data.refreshToken }, native),
    );
    expect(graced.status).toBe(200);
    const gracedSession = (await graced.json()) as NativeSessionResponse;
    expect(gracedSession.data.refreshToken).not.toBe(refreshed.data.refreshToken);

    // Past the grace window the same presentation is reuse and revokes the
    // whole family, including the live head.
    await testEnv()
      .DB.prepare(
        "UPDATE refresh_tokens SET revoked_at = revoked_at - ? WHERE token_hash = ?",
      )
      .bind(REFRESH_REUSE_GRACE_MS + 1, await sha256Hex(login.data.refreshToken))
      .run();
    const reuse = await app.request(
      "/api/auth/refresh",
      jsonRequest({ refreshToken: login.data.refreshToken }, native),
    );
    expect(reuse.status).toBe(401);
    expect(reuse.headers.get("Set-Cookie")).toBeNull();
    const afterReuse = await app.request(
      "/api/auth/refresh",
      jsonRequest({ refreshToken: gracedSession.data.refreshToken }, native),
    );
    expect(afterReuse.status).toBe(401);

    const secondLoginResponse = await app.request(
      "/api/auth/login",
      jsonRequest(
        { email: "alice@example.com", password: "initial-password" },
        native,
      ),
    );
    const secondLogin =
      (await secondLoginResponse.json()) as NativeSessionResponse;
    const logoutResponse = await app.request(
      "/api/auth/logout",
      jsonRequest({ refreshToken: secondLogin.data.refreshToken }, native),
    );
    expect(logoutResponse.status).toBe(204);
    expect(await logoutResponse.text()).toBe("");
    expect(logoutResponse.headers.get("Set-Cookie")).toBeNull();
    const afterLogout = await app.request(
      "/api/auth/refresh",
      jsonRequest({ refreshToken: secondLogin.data.refreshToken }, native),
    );
    expect(afterLogout.status).toBe(401);
  });

  it("validates native refresh bodies and ignores cookies for native clients", async () => {
    const native = { "X-Zenguy-Client": "native" };
    const missing = await app.request(
      "/api/auth/refresh",
      jsonRequest({}, native),
    );
    expect(missing.status).toBe(400);
    expect(missing.headers.get("Set-Cookie")).toBeNull();
    await expect(missing.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });

    const cookieOnly = await app.request("/api/auth/refresh", {
      method: "POST",
      headers: { ...native, Cookie: "zenguy_rt=anything" },
    });
    expect(cookieOnly.status).toBe(400);

    const oversized = await app.request(
      "/api/auth/refresh",
      jsonRequest({ refreshToken: "a".repeat(513) }, native),
    );
    expect(oversized.status).toBe(400);

    const unknown = await app.request(
      "/api/auth/refresh",
      jsonRequest({ refreshToken: "not-a-real-token" }, native),
    );
    expect(unknown.status).toBe(401);
    expect(unknown.headers.get("Set-Cookie")).toBeNull();

    const logoutWithoutToken = await app.request(
      "/api/auth/logout",
      jsonRequest({}, native),
    );
    expect(logoutWithoutToken.status).toBe(204);
    expect(logoutWithoutToken.headers.get("Set-Cookie")).toBeNull();
  });

  it("keeps the cookie flow for browsers even when the client header is wrong", async () => {
    await registerUser(app, "198.51.100.42");
    const loginResponse = await app.request(
      "/api/auth/login",
      jsonRequest(
        { email: "alice@example.com", password: "initial-password" },
        { "X-Zenguy-Client": "web", "CF-Connecting-IP": "198.51.100.43" },
      ),
    );
    expect(loginResponse.status).toBe(200);
    expect(loginResponse.headers.get("Set-Cookie")).toMatch(/^zenguy_rt=/u);
    const body = (await loginResponse.json()) as { data: Record<string, unknown> };
    expect(body.data).not.toHaveProperty("refreshToken");
  });
});
