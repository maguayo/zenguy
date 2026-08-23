import { buildApp } from "../app";
import { fakeBindings } from "../../test/fakes";
import type { ActivityFeedEvent } from "../db/activity";
import type { WorkspaceActivitySummary } from "../db/workspaces";
import type { ActivityLoaders } from "./activity";

const NOW = 1_700_000_000_000;
const clock = { now: () => NOW };
const noDelay = async () => {};
const okFetch = (async () =>
  new Response(JSON.stringify({ data: {} }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })) as typeof fetch;

const events: ActivityFeedEvent[] = [
  {
    actor: { email: "ana@example.com", id: "usr_1", name: "Ana" },
    id: "act_1",
    occurredAt: NOW - 1_000,
    properties: { route: "/tests" },
    resourceId: null,
    resourceType: null,
    source: "web",
    type: "web.page_viewed",
    workspace: { id: "ws_1", name: "Acme" },
  },
];

const workspaces: WorkspaceActivitySummary[] = [
  {
    createdAt: NOW - 86_400_000,
    id: "ws_1",
    lastActiveAt: NOW - 1_000,
    lastAlertSentAt: null,
    lastAppAt: null,
    lastLoginAt: null,
    lastRunAt: null,
    lastRunStatus: null,
    lastTestCreatedAt: null,
    lastWebAt: NOW - 1_000,
    memberCount: 2,
    name: "Acme",
    ownerEmail: "ana@example.com",
    slug: "acme",
  },
];

function fakeLoaders(): ActivityLoaders {
  return {
    activity: vi.fn(async () => ({ events })),
    workspaces: vi.fn(async () => ({ workspaces })),
  };
}

/**
 * The routes themselves are covered by routes/activity.test.ts; what is checked
 * here is that buildApp mounts them at all — behind the session cookie, ahead of
 * the /api/* 404, and under the same no-store header as every other data route.
 */
async function loggedIn(loaders: ActivityLoaders) {
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

describe("activity routes mounted on the app", () => {
  it("serves the feed from the injected loader, uncached", async () => {
    const loaders = fakeLoaders();
    const session = await loggedIn(loaders);

    const response = await session.get("/api/activity");

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ data: { events } });
    expect(loaders.activity).toHaveBeenCalledWith(session.bindings.DB, 50, null);
  });

  it("serves the workspaces table from the injected loader, uncached", async () => {
    const loaders = fakeLoaders();
    const session = await loggedIn(loaders);

    const response = await session.get("/api/workspaces?limit=50");

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ data: { workspaces } });
    expect(loaders.workspaces).toHaveBeenCalledWith(session.bindings.DB, 50);
  });

  it("keeps both endpoints behind the session and unknown API paths on 404", async () => {
    const session = await loggedIn(fakeLoaders());

    for (const path of ["/api/activity", "/api/workspaces"]) {
      const response = await session.anonymous(path);
      expect(response.status, path).toBe(401);
      expect(response.headers.get("Cache-Control"), path).toBe("no-store");
    }
    expect((await session.anonymous("/api/nope")).status).toBe(404);
  });
});
