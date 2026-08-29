import type { Loaders } from "./data";
import { buildApp } from "../app";
import {
  FakeAdminSessionStore,
  allowAdminAccess,
  fakeBindings,
  verifiedLoginBody,
} from "../../test/fakes";
import type {
  Metrics,
  Overview,
  RecentRun,
  UserSummary,
  WorkersResponse,
} from "../../shared/types";

const NOW = 1_700_000_000_000;
const clock = { now: () => NOW };
const noDelay = async () => {};
const okFetch = (async () =>
  new Response(JSON.stringify(verifiedLoginBody()), {
    status: 200,
    headers: { "content-type": "application/json" },
  })) as typeof fetch;

const overview: Overview = {
  users: { total: 4, verified: 3, newLast7d: 1 },
  workspaces: { total: 2 },
  browserTests: { active: 5 },
  uptimeMonitors: { total: 1, up: 1, down: 0, unknown: 0 },
  browserRuns: {
    past: {
      h1: { total: 0, byStatus: {}, passRate: null, avgDurationMs: null },
      h3: { total: 0, byStatus: {}, passRate: null, avgDurationMs: null },
      h24: { total: 0, byStatus: {}, passRate: null, avgDurationMs: null },
    },
    upcoming: { h1: 1, h3: 3, h24: 24 },
  },
  uptimeChecks: {
    past: {
      h1: { total: 0, up: 0, down: 0, avgResponseMs: null },
      h3: { total: 0, up: 0, down: 0, avgResponseMs: null },
      h24: { total: 0, up: 0, down: 0, avgResponseMs: null },
    },
    upcoming: { h1: 12, h3: 36, h24: 288 },
  },
};
const workers: WorkersResponse = { workers: [], now: NOW };
const users: UserSummary[] = [
  {
    id: "usr_00000000000000000000000001",
    email: "one@example.com",
    name: "One",
    createdAt: 1,
    emailVerified: true,
    workspaceCount: 1,
    lastActiveAt: null,
  },
];
const runs: RecentRun[] = [
  {
    id: "run_pass",
    createdAt: 1,
    workspaceName: "Acme",
    testName: "Homepage",
    source: "MANUAL",
    status: "PASSED",
    durationMs: 60_000,
    attemptCount: 1,
    passedAfterRetry: false,
    runnerId: null,
    runnerKind: null,
  },
];

const metrics: Metrics = {
  range: { days: 7, from: "2023-11-08", to: "2023-11-14", now: NOW },
  users: { registered: 4, newInRange: 1, active7d: 2, danger: 1, series: [] },
  tests: {
    total: 5,
    perUser: 2.5,
    failed2h: 1,
    retries: { first: 1, second: 1, thirdPlus: 0 },
    spendCents: { today: 25, last7d: 250, last30d: 300 },
    series: [],
  },
  uptime: { upPercent: 75, monitorsDown: 1, monitorsTotal: 2, openIncidents: 1, series: [] },
};

function fakeLoaders(): Loaders {
  return {
    overview: vi.fn(async () => overview),
    workers: vi.fn(async () => workers),
    users: vi.fn(async () => users),
    runs: vi.fn(async () => runs),
    metrics: vi.fn(async () => metrics),
  };
}

async function loggedIn(loaders: Loaders) {
  const bindings = fakeBindings();
  const sessions = new FakeAdminSessionStore();
  const app = buildApp(bindings, {
    fetch: okFetch,
    delay: noDelay,
    clock,
    loaders,
    sessions,
    accessVerifier: allowAdminAccess,
  });
  const response = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "marcos@aguayo.es", password: "abc123456" }),
  });
  const cookie = (response.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";
  return {
    bindings,
    sessions,
    cookie,
    get: (path: string) => app.request(path, { headers: { Cookie: cookie } }),
    anonymous: (path: string) => app.request(path),
  };
}

const PATHS = [
  "/api/overview",
  "/api/workers",
  "/api/users",
  "/api/runs/recent",
  "/api/metrics",
] as const;

describe("admin data routes", () => {
  it("refuses every data endpoint without a session", async () => {
    const session = await loggedIn(fakeLoaders());
    for (const path of PATHS) {
      const response = await session.anonymous(path);
      expect(response.status, path).toBe(401);
      expect(response.headers.get("Cache-Control"), path).toBe("no-store");
      await expect(response.json()).resolves.toEqual({
        error: { code: "UNAUTHORIZED", message: "Admin session required" },
      });
    }
  });

  it("serves each section from its loader behind the session cookie", async () => {
    const loaders = fakeLoaders();
    const session = await loggedIn(loaders);

    const overviewResponse = await session.get("/api/overview");
    expect(overviewResponse.status).toBe(200);
    expect(overviewResponse.headers.get("Cache-Control")).toBe("no-store");
    await expect(overviewResponse.json()).resolves.toEqual({ data: overview });
    expect(loaders.overview).toHaveBeenCalledWith(session.bindings.DB, NOW);

    await expect((await session.get("/api/workers")).json()).resolves.toEqual({
      data: workers,
    });
    expect(loaders.workers).toHaveBeenCalledWith(session.bindings.DB, NOW);

    await expect((await session.get("/api/users")).json()).resolves.toEqual({
      data: { users },
    });
    await expect((await session.get("/api/runs/recent")).json()).resolves.toEqual({
      data: { runs },
    });
  });

  it("defaults the limit to 50 and accepts up to 200", async () => {
    const loaders = fakeLoaders();
    const session = await loggedIn(loaders);

    await session.get("/api/users");
    await session.get("/api/runs/recent");
    expect(loaders.users).toHaveBeenCalledWith(session.bindings.DB, 50);
    expect(loaders.runs).toHaveBeenCalledWith(session.bindings.DB, 50);

    await session.get("/api/users?limit=200");
    expect(loaders.users).toHaveBeenLastCalledWith(session.bindings.DB, 200);
  });

  it("rejects limits outside 1..200", async () => {
    const session = await loggedIn(fakeLoaders());
    for (const query of ["?limit=0", "?limit=201", "?limit=abc", "?limit=1.5"]) {
      const response = await session.get(`/api/users${query}`);
      expect(response.status, query).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "VALIDATION_ERROR",
          message: "limit must be an integer between 1 and 200",
        },
      });
    }
  });

  it("serves metrics with a validated range, defaulting to 30 days", async () => {
    const loaders = fakeLoaders();
    const session = await loggedIn(loaders);

    const defaulted = await session.get("/api/metrics");
    expect(defaulted.status).toBe(200);
    await expect(defaulted.json()).resolves.toEqual({ data: metrics });
    expect(loaders.metrics).toHaveBeenLastCalledWith(expect.anything(), NOW, 30);

    expect((await session.get("/api/metrics?days=7")).status).toBe(200);
    expect(loaders.metrics).toHaveBeenLastCalledWith(expect.anything(), NOW, 7);
    expect((await session.get("/api/metrics?days=90")).status).toBe(200);
    expect(loaders.metrics).toHaveBeenLastCalledWith(expect.anything(), NOW, 90);
  });

  it("rejects a days value outside 7|30|90", async () => {
    const loaders = fakeLoaders();
    const session = await loggedIn(loaders);
    for (const days of ["14", "0", "abc", "900"]) {
      const response = await session.get(`/api/metrics?days=${days}`);
      expect(response.status, days).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: { code: "VALIDATION_ERROR", message: "days must be 7, 30 or 90" },
      });
    }
    expect(loaders.metrics).not.toHaveBeenCalled();
  });

  it("refuses a still-valid cookie once the user id leaves the allowlist", async () => {
    const session = await loggedIn(fakeLoaders());
    const cookie = session.cookie;

    // The server-side row still exists; only the stable-id allowlist changed.
    const revoked = buildApp(
      fakeBindings({
        ADMIN_USER_IDS: "usr_00000000000000000000000003",
      }),
      {
        fetch: okFetch,
        delay: noDelay,
        clock,
        loaders: fakeLoaders(),
        sessions: session.sessions,
        accessVerifier: allowAdminAccess,
      },
    );

    for (const path of PATHS) {
      const response = await revoked.request(path, { headers: { Cookie: cookie } });
      expect(response.status, path).toBe(401);
      await expect(response.json()).resolves.toEqual({
        error: { code: "UNAUTHORIZED", message: "Admin session required" },
      });
    }
  });

  it("still answers unknown API routes with a 404 rather than a 401", async () => {
    const session = await loggedIn(fakeLoaders());
    expect((await session.anonymous("/api/nope")).status).toBe(404);
  });
});
