import { buildApp } from "../app";
import { fakeBindings } from "../../test/fakes";

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

describe("admin auth", () => {
  it("logs in an allowlisted account validated by the production API and sets the cookie", async () => {
    const { calls, fetchImpl } = fetchReturning(200, { data: { accessToken: "discarded" } });
    const app = buildApp(fakeBindings(), { fetch: fetchImpl, delay: noDelay, clock });

    const response = await login(app, { email: " Marcos@Aguayo.es ", password: "abc123456" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { email: "marcos@aguayo.es" } });
    expect(calls[0]?.url).toBe("https://api.zenguy.test/api/auth/login");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      email: "marcos@aguayo.es",
      password: "abc123456",
    });
    const cookie = response.headers.get("Set-Cookie") ?? "";
    expect(cookie).toMatch(
      /^zenguy_admin_session=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+; Max-Age=604800; Path=\/; HttpOnly; Secure; SameSite=Lax$/u,
    );

    const me = await app.request("/api/auth/me", {
      headers: { Cookie: cookie.split(";")[0] ?? "" },
    });
    await expect(me.json()).resolves.toEqual({ data: { email: "marcos@aguayo.es" } });
  });

  it("rejects non-admin emails without contacting the API, with a generic error and a delay", async () => {
    const { calls, fetchImpl } = fetchReturning(200);
    const delay = vi.fn(async () => {});
    const app = buildApp(fakeBindings(), { fetch: fetchImpl, delay, clock });

    const response = await login(app, { email: "intruder@example.com", password: "whatever" });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "UNAUTHORIZED", message: "Invalid credentials" },
    });
    expect(calls).toHaveLength(0);
    expect(delay).toHaveBeenCalledWith(300);
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });

  it("rejects wrong passwords with the same generic error and the same delay", async () => {
    const { fetchImpl } = fetchReturning(401, { error: { code: "INVALID_CREDENTIALS" } });
    const delay = vi.fn(async () => {});
    const app = buildApp(fakeBindings(), { fetch: fetchImpl, delay, clock });
    const response = await login(app, { email: "marcos@aguayo.es", password: "nope" });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "UNAUTHORIZED", message: "Invalid credentials" },
    });
    expect(delay).toHaveBeenCalledWith(300);
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });

  it("surfaces API rate limiting and unavailability", async () => {
    const limited = buildApp(fakeBindings(), {
      fetch: fetchReturning(429).fetchImpl,
      delay: noDelay,
      clock,
    });
    expect((await login(limited, { email: "marcos@aguayo.es", password: "x" })).status).toBe(429);

    const down = buildApp(fakeBindings(), {
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
    const app = buildApp(fakeBindings(), {
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

  it("treats an API error status as unavailable rather than a bad password", async () => {
    for (const status of [500, 502, 503]) {
      const app = buildApp(fakeBindings(), {
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
    const app = buildApp(fakeBindings(), {
      fetch: fetchReturning(200).fetchImpl,
      delay: noDelay,
      clock,
    });
    expect((await login(app, { email: "not-an-email", password: "" })).status).toBe(400);
  });

  it("stops honouring a signed cookie once the email leaves the allowlist", async () => {
    const { fetchImpl } = fetchReturning(200, { data: {} });
    const secret = fakeBindings().ADMIN_SESSION_SECRET;
    const allowed = buildApp(fakeBindings(), { fetch: fetchImpl, delay: noDelay, clock });
    const cookie = (
      (
        await login(allowed, { email: "marcos@aguayo.es", password: "abc123456" })
      ).headers.get("Set-Cookie") ?? ""
    ).split(";")[0] as string;

    // Same secret, so the signature still verifies; only ADMIN_EMAILS changed.
    const revoked = buildApp(
      fakeBindings({ ADMIN_EMAILS: "someone-else@example.com", ADMIN_SESSION_SECRET: secret }),
      { fetch: fetchImpl, delay: noDelay, clock },
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

  it("requires a valid session for /me and clears it on logout", async () => {
    const app = buildApp(fakeBindings(), {
      fetch: fetchReturning(200).fetchImpl,
      delay: noDelay,
      clock,
    });
    expect((await app.request("/api/auth/me")).status).toBe(401);
    expect(
      (await app.request("/api/auth/me", { headers: { Cookie: "zenguy_admin_session=bad.token" } }))
        .status,
    ).toBe(401);
    const logout = await app.request("/api/auth/logout", { method: "POST" });
    expect(logout.status).toBe(204);
    expect(logout.headers.get("Set-Cookie")).toBe(
      "zenguy_admin_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
  });
});
