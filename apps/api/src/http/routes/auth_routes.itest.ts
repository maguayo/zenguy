import type { Hono } from "hono";
import { buildApp } from "../../app";
import { D1UserRepo } from "../../infrastructure/db/user_repo";
import { loadConfig } from "../../shared/config";
import { RATE_LIMITS } from "../../shared/constants";
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
  const token = new URL(url).searchParams.get("token");
  if (token === null) throw new Error("Expected token query parameter");
  return token;
}

async function registerUser(
  app: Hono<AppEnv>,
  ip: string,
  input = {
    name: "Alice",
    email: "alice@example.com",
    password: "initial-password",
  },
): Promise<Response> {
  return app.request(
    "/api/auth/register",
    jsonRequest(input, { "CF-Connecting-IP": ip }),
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
    const registered = (await registerResponse.json()) as {
      data: { user: Record<string, unknown> };
    };
    expect(registered.data.user).toMatchObject({
      name: "Alice",
      email: "alice@example.com",
      emailVerified: false,
    });
    expect(registered.data.user.createdAt).toEqual(expect.any(String));
    expect(registered.data.user).not.toHaveProperty("passwordHash");
    expect(registered.data.user).not.toHaveProperty("password_hash");

    const verificationToken = tokenFromMessage(emails.messages[0]?.text);
    const verifyResponse = await app.request(
      "/api/auth/verify-email",
      jsonRequest({ token: verificationToken }),
    );
    expect(verifyResponse.status).toBe(200);
    await expect(verifyResponse.json()).resolves.toEqual({
      data: { verified: true },
    });

    const loginResponse = await app.request(
      "/api/auth/login",
      jsonRequest(
        { email: "alice@example.com", password: "initial-password" },
        { "CF-Connecting-IP": "198.51.100.11" },
      ),
    );
    expect(loginResponse.status).toBe(200);
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
    expect(await logoutResponse.text()).toBe("");
    expect(logoutResponse.headers.get("Set-Cookie")).toBe(
      "zenguy_rt=; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=0",
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
});
