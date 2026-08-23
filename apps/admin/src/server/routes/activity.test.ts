import { Hono } from "hono";
import type { ActivityFeedEvent } from "../db/activity";
import type { WorkspaceActivitySummary } from "../db/workspaces";
import type { AppEnv } from "../env";
import { AppError } from "../errors";
import { activityRoutes, type ActivityLoaders, type ActivityRoutesDependencies } from "./activity";

// The session guard belongs to routes/data.test.ts; here it is a stand-in that
// accepts one fixed cookie, so this file tests only what the activity routes
// add (loader wiring, query validation, envelopes) and stays independent of
// the session machinery, which differs between the deployed code and the
// security rewrite in flight.
const SESSION_COOKIE = "admin_session=activity-test";
vi.mock("../require_session", async () => {
  const { AppError: Failure } = await import("../errors");
  return {
    requireSession: () => async (context: { req: { header(name: string): string | undefined } }, next: () => Promise<void>) => {
      if (context.req.header("Cookie") !== SESSION_COOKIE) {
        throw new Failure("UNAUTHORIZED", "Admin session required");
      }
      await next();
    },
  };
});

const NOW = 1_700_000_000_000;
const clock = { now: () => NOW };
const DB = { activityTestDatabase: true } as unknown as D1Database;

const events: ActivityFeedEvent[] = [
  {
    id: "act_newest",
    type: "alert.sent",
    occurredAt: NOW - 1_000,
    source: "server",
    actor: null,
    workspace: { id: "ws_acme", name: "Acme" },
    resourceType: "uptime_monitor",
    resourceId: "mon_home",
    properties: { channel: "email" },
  },
  {
    id: "act_older",
    type: "web.page_viewed",
    occurredAt: NOW - 60_000,
    source: "web",
    actor: { id: "usr_one", name: "One", email: "one@example.com" },
    workspace: { id: "ws_acme", name: "Acme" },
    resourceType: null,
    resourceId: null,
    properties: { route: "/tests" },
  },
];

const workspaces: WorkspaceActivitySummary[] = [
  {
    id: "ws_acme",
    name: "Acme",
    slug: "acme",
    ownerEmail: "one@example.com",
    memberCount: 2,
    createdAt: NOW - 86_400_000,
    lastActiveAt: NOW - 60_000,
    lastWebAt: NOW - 60_000,
    lastAppAt: null,
    lastLoginAt: NOW - 120_000,
    lastTestCreatedAt: NOW - 3_600_000,
    lastRunAt: NOW - 600_000,
    lastRunStatus: "FAILED",
    lastAlertSentAt: NOW - 1_000,
  },
];

type FakeLoaders = ActivityLoaders;

function fakeLoaders(): FakeLoaders {
  return {
    activity: vi.fn(async () => ({ events })),
    workspaces: vi.fn(async () => ({ workspaces })),
  };
}

// Mirrors the app's /api hardening (no-store, JSON error envelope) around the
// routes under test. The session-related dependencies are whatever the guard
// of the day expects; the stand-in above ignores them.
function harnessFor(loaders: FakeLoaders) {
  const harness = new Hono<AppEnv>();
  harness.use("/api/*", async (context, next) => {
    await next();
    context.header("Cache-Control", "no-store");
  });
  harness.onError((error, context) => {
    const appError =
      error instanceof AppError ? error : new AppError("INTERNAL", "Unexpected error");
    return context.json(
      { error: { code: appError.code, message: appError.message } },
      appError.status as 400,
    );
  });
  const dependencies = {
    db: DB,
    clock,
    loaders,
    secret: "unused-by-the-stand-in",
    adminEmails: "unused@example.com",
    adminUserIds: "usr_unused",
    sessions: {},
  } as unknown as ActivityRoutesDependencies;
  harness.route("/api", activityRoutes(dependencies));
  return harness;
}

function loggedIn(loaders: FakeLoaders) {
  const harness = harnessFor(loaders);
  return {
    bindings: { DB },
    get: (path: string) => harness.request(path, { headers: { Cookie: SESSION_COOKIE } }),
    anonymous: (path: string) => harness.request(path),
  };
}

const PATHS = ["/api/activity", "/api/workspaces"] as const;
const LIMIT_ERROR = {
  error: {
    code: "VALIDATION_ERROR",
    message: "limit must be an integer between 1 and 200",
  },
};
const TYPE_ERROR = {
  error: {
    code: "VALIDATION_ERROR",
    message:
      "type must be an event type such as alert.sent (lowercase letters, underscores, one dot, at most 64 characters)",
  },
};

describe("admin activity routes", () => {
  it("refuses both endpoints without a session", async () => {
    const session = loggedIn(fakeLoaders());
    for (const path of PATHS) {
      const response = await session.anonymous(path);
      expect(response.status, path).toBe(401);
      expect(response.headers.get("Cache-Control"), path).toBe("no-store");
      await expect(response.json()).resolves.toEqual({
        error: { code: "UNAUTHORIZED", message: "Admin session required" },
      });
    }
  });

  it("serves the activity feed from its loader behind the session cookie", async () => {
    const loaders = fakeLoaders();
    const session = loggedIn(loaders);

    const response = await session.get("/api/activity");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ data: { events } });
    expect(loaders.activity).toHaveBeenCalledWith(session.bindings.DB, 50, null);
    expect(loaders.workspaces).not.toHaveBeenCalled();
  });

  it("serves the workspaces table from its loader behind the session cookie", async () => {
    const loaders = fakeLoaders();
    const session = loggedIn(loaders);

    const response = await session.get("/api/workspaces");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ data: { workspaces } });
    expect(loaders.workspaces).toHaveBeenCalledWith(session.bindings.DB, 50);
    expect(loaders.activity).not.toHaveBeenCalled();
  });

  it("passes a well-formed type filter and the limit through to the feed loader", async () => {
    const loaders = fakeLoaders();
    const session = loggedIn(loaders);

    expect((await session.get("/api/activity?type=alert.sent")).status).toBe(200);
    expect(loaders.activity).toHaveBeenLastCalledWith(session.bindings.DB, 50, "alert.sent");

    expect(
      (await session.get("/api/activity?limit=200&type=browser_test.run_failed")).status,
    ).toBe(200);
    expect(loaders.activity).toHaveBeenLastCalledWith(
      session.bindings.DB,
      200,
      "browser_test.run_failed",
    );

    expect((await session.get("/api/workspaces?limit=1")).status).toBe(200);
    expect(loaders.workspaces).toHaveBeenLastCalledWith(session.bindings.DB, 1);
  });

  it("rejects a type filter that is not a lowercase subject.verb of at most 64 characters", async () => {
    const loaders = fakeLoaders();
    const session = loggedIn(loaders);
    const tooLong = `${"a".repeat(60)}.verb`;
    expect(tooLong).toHaveLength(65);

    for (const type of [
      "",
      "alert",
      "Alert.sent",
      "alert.sent.twice",
      "alert-sent.now",
      "alert.sent%20OR%201=1",
      "alert.s3nt",
      tooLong,
    ]) {
      const response = await session.get(`/api/activity?type=${type}`);
      expect(response.status, type).toBe(400);
      await expect(response.json()).resolves.toEqual(TYPE_ERROR);
    }
    expect(loaders.activity).not.toHaveBeenCalled();

    // Exactly 64 characters is still fine.
    const longest = `${"a".repeat(59)}.verb`;
    expect(longest).toHaveLength(64);
    expect((await session.get(`/api/activity?type=${longest}`)).status).toBe(200);
    expect(loaders.activity).toHaveBeenLastCalledWith(session.bindings.DB, 50, longest);
  });

  it("rejects limits outside 1..200 on both endpoints", async () => {
    const loaders = fakeLoaders();
    const session = loggedIn(loaders);
    for (const path of PATHS) {
      for (const query of ["?limit=500", "?limit=0", "?limit=abc", "?limit=1.5"]) {
        const response = await session.get(`${path}${query}`);
        expect(response.status, `${path}${query}`).toBe(400);
        await expect(response.json()).resolves.toEqual(LIMIT_ERROR);
      }
    }
    expect(loaders.activity).not.toHaveBeenCalled();
    expect(loaders.workspaces).not.toHaveBeenCalled();
  });

  it("relays a migration-pending answer verbatim", async () => {
    const unavailable = { unavailable: "MIGRATION_PENDING" as const };
    const session = loggedIn({
      activity: vi.fn(async () => unavailable),
      workspaces: vi.fn(async () => unavailable),
    });
    for (const path of PATHS) {
      const response = await session.get(path);
      expect(response.status, path).toBe(200);
      await expect(response.json()).resolves.toEqual({ data: unavailable });
    }
  });
});
