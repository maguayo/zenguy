import { buildApp, type AppOverrides } from "../app";
import {
  ADMIN_EMAIL,
  FakeAdminSessionStore,
  allowAdminAccess,
  fakeBindings,
  verifiedLoginBody,
} from "../../test/fakes";

function fetchReturning(status: number, body: unknown = {}) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const noDelay = async () => {};
const clock = { now: () => 1_700_000_000_000 };

async function login(app: ReturnType<typeof buildApp>, body: unknown) {
  return app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function buildTestApp(
  bindings = fakeBindings(),
  overrides: AppOverrides = {},
): ReturnType<typeof buildApp> {
  return buildApp(bindings, {
    sessions: new FakeAdminSessionStore(),
    accessVerifier: allowAdminAccess,
    ...overrides,
  });
}

describe("admin auth", () => {
  it("logs in an allowlisted account validated by the production API and sets the cookie", async () => {
    const { calls, fetchImpl } = fetchReturning(200, verifiedLoginBody());
    const app = buildTestApp(fakeBindings(), { fetch: fetchImpl, delay: noDelay, clock });

    const response = await login(app, { email: " Marcos@Aguayo.es ", password: "abc123456" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { email: "marcos@aguayo.es" } });
    expect(calls[0]?.url).toBe("https://api.zenguy.com/api/auth/login");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      email: "marcos@aguayo.es",
      password: "abc123456",
    });
    const cookie = response.headers.get("Set-Cookie") ?? "";
    expect(cookie).toMatch(
      /^__Host-zenguy_admin_session=[A-Za-z0-9_-]{43}; Max-Age=1800; Path=\/; HttpOnly; Secure; SameSite=Strict$/u,
    );

    const me = await app.request("/api/auth/me", {
      headers: { Cookie: cookie.split(";")[0] ?? "" },
    });
    await expect(me.json()).resolves.toEqual({ data: { email: "marcos@aguayo.es" } });
  });

  it("rejects a valid account whose stable user id is not allowlisted", async () => {
    const { calls, fetchImpl } = fetchReturning(
      200,
      verifiedLoginBody({
        id: "usr_00000000000000000000000003",
        email: "intruder@example.com",
      }),
    );
    const delay = vi.fn(async () => {});
    const app = buildTestApp(fakeBindings(), {
      fetch: fetchImpl,
      delay,
      clock,
      accessVerifier: {
        verify: async () => ({ email: "intruder@example.com", subject: "access-intruder" }),
      },
    });

    const response = await login(app, { email: "intruder@example.com", password: "whatever" });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "UNAUTHORIZED", message: "Invalid credentials" },
    });
    expect(calls).toHaveLength(1);
    expect(delay).toHaveBeenCalledWith(300);
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });

  it("rejects wrong passwords with the same generic error and the same delay", async () => {
    const { fetchImpl } = fetchReturning(401, { error: { code: "INVALID_CREDENTIALS" } });
    const delay = vi.fn(async () => {});
    const app = buildTestApp(fakeBindings(), { fetch: fetchImpl, delay, clock });
    const response = await login(app, { email: "marcos@aguayo.es", password: "nope" });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "UNAUTHORIZED", message: "Invalid credentials" },
    });
    expect(delay).toHaveBeenCalledWith(300);
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });

  it("rejects an allowlisted id when the API account is unverified or the identity is inconsistent", async () => {
    for (const body of [
      verifiedLoginBody({ emailVerified: false }),
      verifiedLoginBody({ email: "different@example.com" }),
      { data: { accessToken: "token-without-an-identity" } },
    ]) {
      const sessions = new FakeAdminSessionStore();
      const app = buildTestApp(fakeBindings(), {
        fetch: fetchReturning(200, body).fetchImpl,
        delay: noDelay,
        clock,
        sessions,
      });
      const response = await login(app, { email: ADMIN_EMAIL, password: "correct" });
      expect(response.status).toBe(401);
      expect(sessions.sessions.size).toBe(0);
    }
  });

  it("surfaces API rate limiting and unavailability", async () => {
    const limited = buildTestApp(fakeBindings(), {
      fetch: fetchReturning(429).fetchImpl,
      delay: noDelay,
      clock,
    });
    expect((await login(limited, { email: "marcos@aguayo.es", password: "x" })).status).toBe(429);

    const down = buildTestApp(fakeBindings(), {
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
      delay: noDelay,
      clock,
    });
    const response = await login(down, { email: "marcos@aguayo.es", password: "x" });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: { code: "SERVICE_UNAVAILABLE", message: "Production API is not reachable" },
    });
  });

  it("bounds the upstream call and reports a timeout as unavailable", async () => {
    const inits: (RequestInit | undefined)[] = [];
    const app = buildTestApp(fakeBindings(), {
      fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        inits.push(init);
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      }) as typeof fetch,
      delay: noDelay,
      clock,
    });

    const response = await login(app, { email: "marcos@aguayo.es", password: "x" });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: { code: "SERVICE_UNAVAILABLE", message: "Production API is not reachable" },
    });
    expect(inits[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("rejects and cancels an oversized upstream login response", async () => {
    const cancel = vi.fn(async () => undefined);
    const app = buildTestApp(fakeBindings(), {
      fetch: (async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(64 * 1_024 + 1));
            },
            cancel,
          }),
          { status: 200 },
        )) as typeof fetch,
      delay: noDelay,
      clock,
    });

    const response = await login(app, {
      email: "marcos@aguayo.es",
      password: "x",
    });

    expect(response.status).toBe(503);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("treats an API error status as unavailable rather than a bad password", async () => {
    for (const status of [500, 502, 503]) {
      const app = buildTestApp(fakeBindings(), {
        fetch: fetchReturning(status).fetchImpl,
        delay: noDelay,
        clock,
      });
      const response = await login(app, { email: "marcos@aguayo.es", password: "x" });
      expect(response.status, String(status)).toBe(503);
      await expect(response.json()).resolves.toEqual({
        error: { code: "SERVICE_UNAVAILABLE", message: "Production API is not reachable" },
      });
    }
  });

  it("validates the body", async () => {
    const app = buildTestApp(fakeBindings(), {
      fetch: fetchReturning(200, verifiedLoginBody()).fetchImpl,
      delay: noDelay,
      clock,
    });
    expect((await login(app, { email: "not-an-email", password: "" })).status).toBe(400);
  });

  it("fails closed before accepting passwords when the API origin drifts", () => {
    for (const origin of [
      "https://api.zenguy.com.evil.test",
      "https://api.zenguy.com/path",
      "https://user@api.zenguy.com",
      "http://api.zenguy.com",
    ]) {
      expect(() =>
        buildTestApp(fakeBindings({ ZENGUY_API_ORIGIN: origin }), {
          fetch: fetchReturning(200, verifiedLoginBody()).fetchImpl,
        }),
      ).toThrow("ZENGUY_API_ORIGIN must be the production API origin");
    }
  });

  it("allows the documented loopback origin for local development", () => {
    expect(() =>
      buildTestApp(
        fakeBindings({ ZENGUY_API_ORIGIN: "http://127.0.0.1:8799" }),
      ),
    ).not.toThrow();
  });

  it("stops honouring an opaque cookie once the user id leaves the allowlist", async () => {
    const { fetchImpl } = fetchReturning(200, verifiedLoginBody());
    const sessions = new FakeAdminSessionStore();
    const allowed = buildTestApp(fakeBindings(), {
      fetch: fetchImpl,
      delay: noDelay,
      clock,
      sessions,
    });
    const cookie = (
      (
        await login(allowed, { email: "marcos@aguayo.es", password: "abc123456" })
      ).headers.get("Set-Cookie") ?? ""
    ).split(";")[0] as string;

    // The D1 row still exists; only the stable-id allowlist changed.
    const revoked = buildTestApp(
      fakeBindings({ ADMIN_USER_IDS: "usr_00000000000000000000000003" }),
      { fetch: fetchImpl, delay: noDelay, clock, sessions },
    );
    expect((await allowed.request("/api/auth/me", { headers: { Cookie: cookie } })).status).toBe(
      200,
    );
    const response = await revoked.request("/api/auth/me", { headers: { Cookie: cookie } });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "UNAUTHORIZED", message: "Admin session required" },
    });
  });

  it("binds an admin cookie to the stable Access subject, not only its email", async () => {
    const { fetchImpl } = fetchReturning(200, verifiedLoginBody());
    const sessions = new FakeAdminSessionStore();
    const original = buildTestApp(fakeBindings(), {
      fetch: fetchImpl,
      delay: noDelay,
      clock,
      sessions,
      accessVerifier: {
        verify: async () => ({ email: ADMIN_EMAIL, subject: "access-original" }),
      },
    });
    const cookie = (
      (
        await login(original, { email: ADMIN_EMAIL, password: "abc123456" })
      ).headers.get("Set-Cookie") ?? ""
    ).split(";")[0] as string;
    expect(
      (await original.request("/api/auth/me", { headers: { Cookie: cookie } })).status,
    ).toBe(200);

    const reassigned = buildTestApp(fakeBindings(), {
      fetch: fetchImpl,
      delay: noDelay,
      clock,
      sessions,
      accessVerifier: {
        verify: async () => ({ email: ADMIN_EMAIL, subject: "access-reassigned" }),
      },
    });
    const response = await reassigned.request("/api/auth/me", {
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(401);
  });

  it("requires a valid session for /me and clears it on logout", async () => {
    const sessions = new FakeAdminSessionStore();
    const app = buildTestApp(fakeBindings(), {
      fetch: fetchReturning(200, verifiedLoginBody()).fetchImpl,
      delay: noDelay,
      clock,
      sessions,
    });
    expect((await app.request("/api/auth/me")).status).toBe(401);
    expect(
      (await app.request("/api/auth/me", { headers: { Cookie: "__Host-zenguy_admin_session=bad.token" } }))
        .status,
    ).toBe(401);
    const loggedIn = await login(app, { email: ADMIN_EMAIL, password: "abc123456" });
    const cookie = (loggedIn.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";
    expect((await app.request("/api/auth/me", { headers: { Cookie: cookie } })).status).toBe(200);
    const logout = await app.request("/api/auth/logout", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(logout.status).toBe(204);
    expect(logout.headers.get("Set-Cookie")).toBe(
      "__Host-zenguy_admin_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict",
    );
    expect((await app.request("/api/auth/me", { headers: { Cookie: cookie } })).status).toBe(401);
  });
});
