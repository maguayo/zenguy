import type { Hono } from "hono";
import { buildApp } from "../../app";
import type { User } from "../../domain/users/types";
import type { Workspace } from "../../domain/workspaces/types";
import { issueAccessToken } from "../../infrastructure/auth/jwt";
import { D1ActivityEventRepo } from "../../infrastructure/db/activity_event_repo";
import { D1MemberRepo } from "../../infrastructure/db/member_repo";
import { D1UserRepo } from "../../infrastructure/db/user_repo";
import { D1WorkspaceRepo } from "../../infrastructure/db/workspace_repo";
import { FixedClock, systemClock } from "../../shared/clock";
import { loadConfig, type Bindings } from "../../shared/config";
import type { RateLimiter } from "../../shared/ratelimit";
import { FakeIds } from "../../test/fakes/ids";
import { freshDb, testEnv } from "../../test/helpers";
import type { AppEnv } from "../env";

type Actor = "owner" | "member" | "unverified";
const NOW = Date.parse("2026-08-23T09:00:00.000Z");
const USERS: Record<Actor, User> = {
  owner: {
    id: "usr_activity_owner",
    name: "Activity Owner",
    email: "owner@activity-route.test",
    passwordHash: "unused",
    emailVerifiedAt: NOW,
    authVersion: 1,
    createdAt: NOW,
    updatedAt: NOW,
  },
  member: {
    id: "usr_activity_member",
    name: "Activity Member",
    email: "member@activity-route.test",
    passwordHash: "unused",
    emailVerifiedAt: NOW,
    authVersion: 1,
    createdAt: NOW,
    updatedAt: NOW,
  },
  unverified: {
    id: "usr_activity_unverified",
    name: "Activity Unverified",
    email: "unverified@activity-route.test",
    passwordHash: "unused",
    emailVerifiedAt: null,
    authVersion: 1,
    createdAt: NOW,
    updatedAt: NOW,
  },
};
const WORKSPACE: Workspace = {
  id: "ws_activity_route",
  name: "Activity Route Workspace",
  slug: "activity-route-workspace",
  timezone: "UTC",
  ownerUserId: USERS.owner.id,
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
};
// Exists, but only the owner belongs to it: the member must not be able to
// attach visits to it, and the response must not reveal that it exists.
const FOREIGN_WORKSPACE: Workspace = {
  ...WORKSPACE,
  id: "ws_activity_foreign",
  name: "Activity Foreign Workspace",
  slug: "activity-foreign-workspace",
};

class RecordingRateLimiter implements RateLimiter {
  readonly keys: string[] = [];

  constructor(private readonly allowed: number) {}

  async hit(key: string): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    this.keys.push(key);
    if (key === "events:daily:global") {
      return { allowed: true, retryAfterSeconds: 42 };
    }
    const hits = this.keys.filter((candidate) => candidate === key).length;
    return { allowed: hits <= this.allowed, retryAfterSeconds: 42 };
  }
}

describe("POST /api/me/events", () => {
  let bindings: Bindings;
  let app: Hono<AppEnv>;
  let tokens: Record<Actor, string>;

  const post = async (
    token: string | null,
    body: unknown,
    extraHeaders: Record<string, string> = {},
    target: Hono<AppEnv> = app,
  ): Promise<Response> =>
    await target.request("/api/me/events", {
      method: "POST",
      headers: {
        ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
        "Content-Type": "application/json",
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    });

  const storedRows = () => new D1ActivityEventRepo(bindings.DB).listRecent(10);

  beforeEach(async () => {
    await freshDb();
    bindings = testEnv();
    const users = new D1UserRepo(bindings.DB);
    const workspaces = new D1WorkspaceRepo(bindings.DB);
    const members = new D1MemberRepo(bindings.DB);
    for (const user of Object.values(USERS)) await users.insert(user);
    await workspaces.insert(WORKSPACE);
    await workspaces.insert(FOREIGN_WORKSPACE);
    await members.insert({
      id: "mem_activity_owner",
      workspaceId: WORKSPACE.id,
      userId: USERS.owner.id,
      role: "OWNER",
      invitedBy: null,
      joinedAt: NOW,
    });
    await members.insert({
      id: "mem_activity_member",
      workspaceId: WORKSPACE.id,
      userId: USERS.member.id,
      role: "MEMBER",
      invitedBy: USERS.owner.id,
      joinedAt: NOW,
    });
    await members.insert({
      id: "mem_activity_foreign_owner",
      workspaceId: FOREIGN_WORKSPACE.id,
      userId: USERS.owner.id,
      role: "OWNER",
      invitedBy: null,
      joinedAt: NOW,
    });
    const config = loadConfig(bindings);
    tokens = Object.fromEntries(
      await Promise.all(
        (Object.keys(USERS) as Actor[]).map(async (actor) => [
          actor,
          await issueAccessToken(config, USERS[actor], systemClock),
        ]),
      ),
    ) as Record<Actor, string>;
    app = buildApp(bindings, { clock: new FixedClock(NOW), ids: new FakeIds() });
  });

  it("stores web visits for the caller and reports counts", async () => {
    const response = await post(tokens.member, {
      events: [
        {
          type: "web.page_viewed",
          workspaceId: WORKSPACE.id,
          properties: { page: "/w/:wsId/overview" },
        },
        { type: "browser_test.viewed", workspaceId: WORKSPACE.id, resourceId: "bt_1" },
      ],
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ data: { accepted: 2, dropped: 0 } });
    const rows = await storedRows();
    expect(rows.map((row) => [row.type, row.source, row.userId, row.workspaceId])).toEqual([
      ["browser_test.viewed", "web", USERS.member.id, WORKSPACE.id],
      ["web.page_viewed", "web", USERS.member.id, WORKSPACE.id],
    ]);
    expect(rows[0]).toMatchObject({
      resourceType: "browser_test",
      resourceId: "bt_1",
      propertiesJson: null,
      occurredAt: NOW,
    });
    expect(rows[1]).toMatchObject({
      resourceType: null,
      resourceId: null,
      propertiesJson: JSON.stringify({ page: "/w/:wsId/overview" }),
      occurredAt: NOW,
    });
    expect(rows.every((row) => row.id.startsWith("act_"))).toBe(true);
  });

  it("marks native clients as app", async () => {
    const response = await post(
      tokens.member,
      {
        events: [
          { type: "app.opened" },
          {
            type: "app.screen_viewed",
            workspaceId: WORKSPACE.id,
            properties: { screen: "tests" },
          },
        ],
      },
      { "X-Zenguy-Client": "native" },
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ data: { accepted: 2, dropped: 0 } });
    const rows = await storedRows();
    expect(rows.map((row) => [row.type, row.source, row.workspaceId])).toEqual([
      ["app.screen_viewed", "app", WORKSPACE.id],
      ["app.opened", "app", null],
    ]);
  });

  it("drops events for a workspace the caller does not belong to", async () => {
    const response = await post(tokens.member, {
      events: [
        { type: "web.page_viewed", workspaceId: FOREIGN_WORKSPACE.id },
        { type: "run.viewed", workspaceId: "ws_does_not_exist", resourceId: "run_1" },
      ],
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ data: { accepted: 0, dropped: 2 } });
    expect(await storedRows()).toEqual([]);
  });

  it("drops server-only and unknown types while keeping the rest of the batch", async () => {
    const response = await post(tokens.member, {
      events: [
        { type: "browser_test.created", workspaceId: WORKSPACE.id, resourceId: "bt_1" },
        { type: "user.logged_in" },
        { type: "something.unknown", workspaceId: WORKSPACE.id },
        { type: "incident.viewed", workspaceId: WORKSPACE.id, resourceId: "inc_1" },
      ],
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ data: { accepted: 1, dropped: 3 } });
    expect((await storedRows()).map((row) => row.type)).toEqual(["incident.viewed"]);
  });

  it("rejects unauthenticated calls", async () => {
    const response = await post(null, {
      events: [{ type: "web.page_viewed", workspaceId: WORKSPACE.id }],
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UNAUTHORIZED" },
    });
    expect(await storedRows()).toEqual([]);
  });

  it("rejects batches over 25 events or malformed properties", async () => {
    const oversized = await post(tokens.member, {
      events: Array.from({ length: 26 }, () => ({
        type: "web.page_viewed",
        workspaceId: WORKSPACE.id,
      })),
    });
    expect(oversized.status).toBe(400);
    await expect(oversized.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });

    const nested = await post(tokens.member, {
      events: [
        { type: "web.page_viewed", workspaceId: WORKSPACE.id, properties: { nested: {} } },
      ],
    });
    expect(nested.status).toBe(400);
    await expect(nested.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });

    const empty = await post(tokens.member, { events: [] });
    expect(empty.status).toBe(400);

    const tooManyWorkspaces = await post(tokens.member, {
      events: Array.from({ length: 6 }, (_, index) => ({
        type: "web.page_viewed",
        workspaceId: `ws_${index}`,
      })),
    });
    expect(tooManyWorkspaces.status).toBe(400);

    expect(await storedRows()).toEqual([]);
  });

  it("rate limits per user", async () => {
    const rateLimiter = new RecordingRateLimiter(1);
    const limitedApp = buildApp(bindings, {
      clock: new FixedClock(NOW),
      ids: new FakeIds(),
      rateLimiter,
    });
    const body = { events: [{ type: "web.page_viewed", workspaceId: WORKSPACE.id }] };

    const first = await post(
      tokens.member,
      body,
      { "CF-Connecting-IP": "203.0.113.10" },
      limitedApp,
    );
    expect(first.status).toBe(202);
    const second = await post(
      tokens.member,
      body,
      { "CF-Connecting-IP": "203.0.113.10" },
      limitedApp,
    );
    expect(second.status).toBe(429);
    expect(second.headers.get("Retry-After")).toBe("42");
    await expect(second.json()).resolves.toMatchObject({
      error: { code: "RATE_LIMITED" },
    });
    // Another user has its own budget.
    const other = await post(
      tokens.owner,
      body,
      { "CF-Connecting-IP": "203.0.113.11" },
      limitedApp,
    );
    expect(other.status).toBe(202);

    expect(rateLimiter.keys).toEqual([
      `events:user:${USERS.member.id}`,
      expect.stringMatching(/^events:ip:[0-9a-f]{64}$/u),
      `events:daily:user:${USERS.member.id}`,
      expect.stringMatching(/^events:daily:ip:[0-9a-f]{64}$/u),
      "events:daily:global",
      `events:user:${USERS.member.id}`,
      expect.stringMatching(/^events:ip:[0-9a-f]{64}$/u),
      `events:user:${USERS.owner.id}`,
      expect.stringMatching(/^events:ip:[0-9a-f]{64}$/u),
      `events:daily:user:${USERS.owner.id}`,
      expect.stringMatching(/^events:daily:ip:[0-9a-f]{64}$/u),
      "events:daily:global",
    ]);
    expect((await storedRows()).map((row) => row.userId)).toEqual([
      USERS.owner.id,
      USERS.member.id,
    ]);
  });

  it("rejects unverified accounts before event writes", async () => {
    const rateLimiter = new RecordingRateLimiter(100);
    const limitedApp = buildApp(bindings, {
      clock: new FixedClock(NOW),
      ids: new FakeIds(),
      rateLimiter,
    });
    const response = await post(
      tokens.unverified,
      {
        events: [
          {
            type: "web.page_viewed",
            properties: { page: "/verify-pending" },
          },
        ],
      },
      {},
      limitedApp,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "EMAIL_NOT_VERIFIED" },
    });
    expect(rateLimiter.keys).toEqual([]);
    expect(await storedRows()).toEqual([]);
  });
});
