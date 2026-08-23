import type { ActivityLoaders } from "./activity";
import type { Loaders } from "./data";
import { buildApp } from "../app";
import {
  FakeAdminSessionStore,
  allowAdminAccess,
  fakeBindings,
  verifiedLoginBody,
} from "../../test/fakes";
import type { ActivityFeedEvent } from "../db/activity";
import type { WorkspaceActivitySummary } from "../db/workspaces";

const NOW = 1_700_000_000_000;
const clock = { now: () => NOW };
const noDelay = async () => {};
const okFetch = (async () =>
  new Response(JSON.stringify(verifiedLoginBody()), {
    status: 200,
    headers: { "content-type": "application/json" },
  })) as typeof fetch;

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

// The activity fakes travel on the same `loaders` override the data routes
// read, so the type keeps the data keys (all optional) alongside ours.
type FakeLoaders = ActivityLoaders & Partial<Loaders>;

function fakeLoaders(): FakeLoaders {
  return {
    activity: vi.fn(async () => ({ events })),
    workspaces: vi.fn(async () => ({ workspaces })),
  };
}

async function loggedIn(loaders: FakeLoaders) {
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

  it("serves the activity feed from its loader behind the session cookie", async () => {
    const loaders = fakeLoaders();
    const session = await loggedIn(loaders);

    const response = await session.get("/api/activity");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ data: { events } });
    expect(loaders.activity).toHaveBeenCalledWith(session.bindings.DB, 50, null);
    expect(loaders.workspaces).not.toHaveBeenCalled();
  });

  it("serves the workspaces table from its loader behind the session cookie", async () => {
    const loaders = fakeLoaders();
    const session = await loggedIn(loaders);

    const response = await session.get("/api/workspaces");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ data: { workspaces } });
    expect(loaders.workspaces).toHaveBeenCalledWith(session.bindings.DB, 50);
    expect(loaders.activity).not.toHaveBeenCalled();
  });

  it("passes a well-formed type filter and the limit through to the feed loader", async () => {
    const loaders = fakeLoaders();
    const session = await loggedIn(loaders);

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
    const session = await loggedIn(loaders);
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
    const session = await loggedIn(loaders);
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
    const session = await loggedIn({
      activity: vi.fn(async () => unavailable),
      workspaces: vi.fn(async () => unavailable),
    });
    for (const path of PATHS) {
      const response = await session.get(path);
      expect(response.status, path).toBe(200);
      await expect(response.json()).resolves.toEqual({ data: unavailable });
    }
  });

  it("refuses a still-valid cookie once the user id leaves the allowlist", async () => {
    const session = await loggedIn(fakeLoaders());

    // The server-side row still exists; only the stable-id allowlist changed.
    const revoked = buildApp(fakeBindings({ ADMIN_USER_IDS: "usr_someone_else" }), {
      fetch: okFetch,
      delay: noDelay,
      clock,
      loaders: fakeLoaders(),
      sessions: session.sessions,
      accessVerifier: allowAdminAccess,
    });

    for (const path of PATHS) {
      const response = await revoked.request(path, { headers: { Cookie: session.cookie } });
      expect(response.status, path).toBe(401);
      await expect(response.json()).resolves.toEqual({
        error: { code: "UNAUTHORIZED", message: "Admin session required" },
      });
    }
  });
});
