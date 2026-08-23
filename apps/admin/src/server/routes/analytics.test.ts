import { createMiddleware } from "hono/factory";
import type { AnalyticsLoaders } from "./analytics";
import { analyticsRoutes } from "./analytics";
import { buildApp } from "../app";
import type { AppEnv } from "../env";
import { fakeBindings } from "../../test/fakes";
import type { Analytics } from "../../shared/types";

const NOW = 1_700_000_000_000;
const clock = { now: () => NOW };
const noDelay = async () => {};
const okFetch = (async () =>
  new Response(JSON.stringify({ data: {} }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })) as typeof fetch;

const analytics: Analytics = {
  range: { days: 7, from: "2023-11-08", to: "2023-11-14", now: NOW },
  users: [],
  runs: [],
  checks: [],
  incidents: [],
  deliveries: [],
  business: {
    payingWorkspaces: 2,
    mrrCents: 7_800,
    freeWorkspaces: 4,
    grantWorkspaces: 1,
    creditTopupsCents30d: 1_000,
    openIncidents: 0,
    activeUsers7d: 3,
    activeUsers30d: 9,
  },
  topFailingTests: [],
  slowestTests: [],
  activeWorkspaces: [],
  monitorsDown: [],
  openIncidents: [],
};

/** Lets every request through: the guard has its own tests in data.test.ts. */
const openGuard = createMiddleware<AppEnv>(async (_context, next) => {
  await next();
});

function fakeLoaders(): AnalyticsLoaders {
  return { analytics: vi.fn(async () => analytics) };
}

function build(loaders: AnalyticsLoaders) {
  const db = {} as D1Database;
  const app = analyticsRoutes({ db, clock, guard: openGuard, loaders });
  return { db, get: (path: string) => app.request(path) };
}

/**
 * The mounted app: AppError only becomes a status through buildApp's onError,
 * exactly as for the data routes, so the failure cases are checked from there.
 */
async function loggedIn(loaders: AnalyticsLoaders) {
  const bindings = fakeBindings();
  const app = buildApp(bindings, { fetch: okFetch, delay: noDelay, clock, loaders });
  const login = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "marcos@aguayo.es", password: "abc123456" }),
  });
  const cookie = (login.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";
  return {
    bindings,
    get: (path: string) => app.request(path, { headers: { Cookie: cookie } }),
    anonymous: (path: string) => app.request(path),
  };
}

describe("admin analytics route", () => {
  it("serves the loader payload behind the guard", async () => {
    const loaders = fakeLoaders();
    const route = build(loaders);

    const response = await route.get("/analytics?days=7");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: analytics });
    expect(loaders.analytics).toHaveBeenCalledWith(route.db, NOW, 7);
  });

  it("defaults to 30 days and accepts 7, 30 and 90", async () => {
    const loaders = fakeLoaders();
    const route = build(loaders);

    await route.get("/analytics");
    expect(loaders.analytics).toHaveBeenLastCalledWith(route.db, NOW, 30);

    for (const days of [7, 30, 90]) {
      const response = await route.get(`/analytics?days=${days}`);
      expect(response.status, `days=${days}`).toBe(200);
      expect(loaders.analytics).toHaveBeenLastCalledWith(route.db, NOW, days);
    }
  });

  it("rejects any other range", async () => {
    const loaders = fakeLoaders();
    const session = await loggedIn(loaders);

    for (const query of ["?days=5", "?days=0", "?days=365", "?days=abc", "?days=7.5"]) {
      const response = await session.get(`/api/analytics${query}`);
      expect(response.status, query).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: { code: "VALIDATION_ERROR", message: "days must be 7, 30 or 90" },
      });
    }
    expect(loaders.analytics).not.toHaveBeenCalled();
  });

  it("answers through buildApp behind the session cookie, uncached", async () => {
    const loaders = fakeLoaders();
    const session = await loggedIn(loaders);

    const anonymous = await session.anonymous("/api/analytics");
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("Cache-Control")).toBe("no-store");

    const response = await session.get("/api/analytics?days=90");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ data: analytics });
    expect(loaders.analytics).toHaveBeenCalledWith(session.bindings.DB, NOW, 90);
  });

  it("still answers an unknown API route with a 404", async () => {
    const session = await loggedIn(fakeLoaders());
    expect((await session.anonymous("/api/nope")).status).toBe(404);
  });
});
