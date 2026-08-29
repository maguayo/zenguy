import type { Hono } from "hono";
import { buildApp } from "../../app";
import type { Subscription } from "../../domain/billing/types";
import type { BrowserTest } from "../../domain/browser_tests/types";
import type { UptimeMonitor } from "../../domain/uptime/types";
import type { User } from "../../domain/users/types";
import type { Role, Workspace } from "../../domain/workspaces/types";
import { issueAccessToken } from "../../infrastructure/auth/jwt";
import { D1BrowserTestRepo } from "../../infrastructure/db/browser_test_repo";
import { D1MemberRepo } from "../../infrastructure/db/member_repo";
import { D1MonitorRepo } from "../../infrastructure/db/monitor_repo";
import { D1SubscriptionRepo } from "../../infrastructure/db/subscription_repo";
import { D1UserRepo } from "../../infrastructure/db/user_repo";
import { D1WorkspaceRepo } from "../../infrastructure/db/workspace_repo";
import { FixedClock } from "../../shared/clock";
import { loadConfig } from "../../shared/config";
import { FakeIds } from "../../test/fakes/ids";
import { freshDb, freshKv, testEnv } from "../../test/helpers";
import type { AppEnv } from "../env";

type Actor = "owner" | "admin" | "member";
const NOW = Date.now();
const USERS: Record<Actor, User> = {
  owner: {
    id: "usr_sp_owner",
    name: "SP Owner",
    email: "sp-owner@zenguy.test",
    passwordHash: "unused",
    emailVerifiedAt: NOW,
    authVersion: 1,
    createdAt: NOW,
    updatedAt: NOW,
  },
  admin: {
    id: "usr_sp_admin",
    name: "SP Admin",
    email: "sp-admin@zenguy.test",
    passwordHash: "unused",
    emailVerifiedAt: NOW,
    authVersion: 1,
    createdAt: NOW,
    updatedAt: NOW,
  },
  member: {
    id: "usr_sp_member",
    name: "SP Member",
    email: "sp-member@zenguy.test",
    passwordHash: "unused",
    emailVerifiedAt: NOW,
    authVersion: 1,
    createdAt: NOW,
    updatedAt: NOW,
  },
};
const ROLES: Record<Actor, Role> = {
  owner: "OWNER",
  admin: "ADMIN",
  member: "MEMBER",
};
const WORKSPACE: Workspace = {
  id: "ws_sp_routes",
  name: "Status Pages",
  slug: "status-pages",
  timezone: "UTC",
  ownerUserId: USERS.owner.id,
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
};
const OTHER_WORKSPACE: Workspace = {
  id: "ws_sp_other",
  name: "Other",
  slug: "sp-other",
  timezone: "UTC",
  ownerUserId: USERS.owner.id,
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
};

function subscription(id: string, workspaceId: string): Subscription {
  return {
    id,
    workspaceId,
    provider: "paddle",
    providerCustomerId: `ctm_${id}`,
    providerSubscriptionId: `psub_${id}`,
    status: "ACTIVE",
    periodStart: NOW - 86_400_000,
    periodEnd: NOW + 30 * 86_400_000,
    cancelAtPeriodEnd: false,
    updatePaymentUrl: null,
    cancelUrl: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function monitor(id: string, workspaceId = WORKSPACE.id): UptimeMonitor {
  return {
    id,
    workspaceId,
    name: "internal healthz",
    url: "https://internal.example.com/healthz",
    method: "GET",
    encryptedHeaders: null,
    encryptedBody: null,
    expectedStatus: 200,
    bodyCondition: null,
    bodyExpectedValue: null,
    bodyConditionPath: null,
    frequencySeconds: 300,
    timeoutSeconds: 10,
    maxRetries: 0,
    notifyOnRecovery: true,
    nextCheckAt: NOW,
    currentStatus: "UP",
    currentCycleId: null,
    cycleStartedAt: null,
    lastCheckAt: NOW,
    lastResponseTimeMs: 42,
    createdBy: USERS.owner.id,
    createdAt: NOW - 86_400_000,
    updatedAt: NOW,
    deletedAt: null,
  };
}

function browserTest(id: string): BrowserTest {
  return {
    id,
    workspaceId: WORKSPACE.id,
    name: "internal checkout",
    allowedDomains: [],
    writableDomains: [],
    testDataAttested: false,
    irreversibleActionScopes: [],
    startUrl: "https://shop.example.com",
    instructions: "Check checkout",
    device: "DESKTOP",
    intervalHours: 6,
    maxRetries: 0,
    notifyOnRecovery: true,
    nextRunAt: NOW,
    createdBy: USERS.owner.id,
    updatedBy: null,
    createdAt: NOW - 86_400_000,
    updatedAt: NOW,
    deletedAt: null,
  };
}

describe("status page routes", () => {
  let app: Hono<AppEnv>;
  let tokens: Record<Actor, string>;

  beforeEach(async () => {
    await Promise.all([freshDb(), freshKv()]);
    const bindings = testEnv();
    const config = loadConfig(bindings);
    const users = new D1UserRepo(bindings.DB);
    const workspaces = new D1WorkspaceRepo(bindings.DB);
    const members = new D1MemberRepo(bindings.DB);
    for (const user of Object.values(USERS)) await users.insert(user);
    await workspaces.insert(WORKSPACE);
    await workspaces.insert(OTHER_WORKSPACE);
    let sequence = 0;
    for (const actor of ["owner", "admin", "member"] as const) {
      sequence += 1;
      await members.insert({
        id: `mem_sp_${sequence}`,
        workspaceId: WORKSPACE.id,
        userId: USERS[actor].id,
        role: ROLES[actor],
        invitedBy: actor === "owner" ? null : USERS.owner.id,
        joinedAt: NOW + sequence,
      });
    }
    await members.insert({
      id: "mem_sp_other",
      workspaceId: OTHER_WORKSPACE.id,
      userId: USERS.owner.id,
      role: "OWNER",
      invitedBy: null,
      joinedAt: NOW,
    });
    const subscriptions = new D1SubscriptionRepo(bindings.DB);
    await subscriptions.upsertByWorkspace(subscription("sub_sp", WORKSPACE.id));
    await subscriptions.upsertByWorkspace(
      subscription("sub_sp_other", OTHER_WORKSPACE.id),
    );
    await new D1MonitorRepo(bindings.DB).insert(monitor("mon_sp"));
    await new D1BrowserTestRepo(bindings.DB).insert(browserTest("bt_sp"));
    const clock = new FixedClock(NOW);
    tokens = {
      owner: `Bearer ${await issueAccessToken(config, USERS.owner, clock)}`,
      admin: `Bearer ${await issueAccessToken(config, USERS.admin, clock)}`,
      member: `Bearer ${await issueAccessToken(config, USERS.member, clock)}`,
    };
    app = buildApp(bindings, { clock, ids: new FakeIds() });
  });

  function headers(actor: Actor): HeadersInit {
    return {
      Authorization: tokens[actor],
      "content-type": "application/json",
    };
  }

  function base(workspaceId = WORKSPACE.id): string {
    return `/api/workspaces/${workspaceId}/status-pages`;
  }

  async function createPage(
    actor: Actor = "admin",
    body: Record<string, unknown> = { title: "Acme Status", slug: "acme" },
  ) {
    return app.request(base(), {
      method: "POST",
      headers: headers(actor),
      body: JSON.stringify(body),
    });
  }

  async function createdPageId(): Promise<string> {
    const response = await createPage();
    expect(response.status).toBe(201);
    const payload = (await response.json()) as { data: { id: string } };
    return payload.data.id;
  }

  it("creates, lists and gets pages; members read but cannot write", async () => {
    const created = await createPage();
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as {
      data: { id: string; slug: string; publishedAt: string | null };
    };
    expect(createdBody.data.slug).toBe("acme");
    expect(createdBody.data.publishedAt).toBeNull();

    const listed = await app.request(base(), { headers: headers("member") });
    expect(listed.status).toBe(200);
    const listBody = (await listed.json()) as { data: { id: string }[] };
    expect(listBody.data).toHaveLength(1);

    const detail = await app.request(`${base()}/${createdBody.data.id}`, {
      headers: headers("member"),
    });
    expect(detail.status).toBe(200);
    await expect(detail.json()).resolves.toMatchObject({
      data: { id: createdBody.data.id, items: [] },
    });

    const memberCreate = await createPage("member", {
      title: "Nope",
      slug: "nope-page",
    });
    expect(memberCreate.status).toBe(403);
    const memberPatch = await app.request(`${base()}/${createdBody.data.id}`, {
      method: "PATCH",
      headers: headers("member"),
      body: JSON.stringify({ title: "Nope" }),
    });
    expect(memberPatch.status).toBe(403);
  });

  it("rejects duplicate slugs across workspaces and frees them after delete", async () => {
    expect((await createPage()).status).toBe(201);
    const conflicting = await app.request(base(OTHER_WORKSPACE.id), {
      method: "POST",
      headers: headers("owner"),
      body: JSON.stringify({ title: "Other", slug: "acme" }),
    });
    expect(conflicting.status).toBe(409);

    const listed = await app.request(base(), { headers: headers("owner") });
    const { data } = (await listed.json()) as { data: { id: string }[] };
    const pageId = data[0]?.id ?? "";
    const deleted = await app.request(`${base()}/${pageId}`, {
      method: "DELETE",
      headers: headers("owner"),
    });
    expect(deleted.status).toBe(200);

    const reused = await app.request(base(OTHER_WORKSPACE.id), {
      method: "POST",
      headers: headers("owner"),
      body: JSON.stringify({ title: "Other", slug: "acme" }),
    });
    expect(reused.status).toBe(201);
  });

  it("manages items: add, duplicate conflict, rename, reorder and validation", async () => {
    const pageId = await createdPageId();

    const addMonitor = await app.request(`${base()}/${pageId}/items`, {
      method: "POST",
      headers: headers("admin"),
      body: JSON.stringify({
        resourceType: "UPTIME_MONITOR",
        resourceId: "mon_sp",
        displayName: "Public API",
      }),
    });
    expect(addMonitor.status).toBe(201);
    const monitorItem = (await addMonitor.json()) as {
      data: { id: string; resourceId: string; position: number };
    };
    expect(monitorItem.data.resourceId).toBe("mon_sp");
    expect(monitorItem.data.position).toBe(0);

    const addTest = await app.request(`${base()}/${pageId}/items`, {
      method: "POST",
      headers: headers("admin"),
      body: JSON.stringify({
        resourceType: "BROWSER_TEST",
        resourceId: "bt_sp",
        displayName: "Checkout",
        groupName: "Shop",
      }),
    });
    expect(addTest.status).toBe(201);
    const testItem = (await addTest.json()) as { data: { id: string } };

    const duplicate = await app.request(`${base()}/${pageId}/items`, {
      method: "POST",
      headers: headers("admin"),
      body: JSON.stringify({
        resourceType: "UPTIME_MONITOR",
        resourceId: "mon_sp",
        displayName: "Again",
      }),
    });
    expect(duplicate.status).toBe(409);

    const missing = await app.request(`${base()}/${pageId}/items`, {
      method: "POST",
      headers: headers("admin"),
      body: JSON.stringify({
        resourceType: "UPTIME_MONITOR",
        resourceId: "mon_ghost",
        displayName: "Ghost",
      }),
    });
    expect(missing.status).toBe(404);

    const renamed = await app.request(
      `${base()}/${pageId}/items/${monitorItem.data.id}`,
      {
        method: "PATCH",
        headers: headers("admin"),
        body: JSON.stringify({ displayName: "API" }),
      },
    );
    expect(renamed.status).toBe(200);
    await expect(renamed.json()).resolves.toMatchObject({
      data: { displayName: "API" },
    });

    const reorder = await app.request(`${base()}/${pageId}/items/order`, {
      method: "PUT",
      headers: headers("admin"),
      body: JSON.stringify({
        itemIds: [testItem.data.id, monitorItem.data.id],
      }),
    });
    expect(reorder.status).toBe(200);
    const detail = await app.request(`${base()}/${pageId}`, {
      headers: headers("member"),
    });
    const detailBody = (await detail.json()) as {
      data: { items: { id: string }[] };
    };
    expect(detailBody.data.items.map((item) => item.id)).toEqual([
      testItem.data.id,
      monitorItem.data.id,
    ]);

    const badReorder = await app.request(`${base()}/${pageId}/items/order`, {
      method: "PUT",
      headers: headers("admin"),
      body: JSON.stringify({ itemIds: [testItem.data.id] }),
    });
    expect(badReorder.status).toBe(400);
  });

  it("publishes and unpublishes with ISO timestamps", async () => {
    const pageId = await createdPageId();
    const published = await app.request(`${base()}/${pageId}/publish`, {
      method: "POST",
      headers: headers("admin"),
    });
    expect(published.status).toBe(200);
    const publishedBody = (await published.json()) as {
      data: { publishedAt: string | null };
    };
    expect(publishedBody.data.publishedAt).toBe(new Date(NOW).toISOString());

    const unpublished = await app.request(`${base()}/${pageId}/unpublish`, {
      method: "POST",
      headers: headers("admin"),
    });
    expect(unpublished.status).toBe(200);
    await expect(unpublished.json()).resolves.toMatchObject({
      data: { publishedAt: null },
    });
  });

  it("serves the draft preview to members as HTML without meta refresh", async () => {
    const pageId = await createdPageId();
    await app.request(`${base()}/${pageId}/items`, {
      method: "POST",
      headers: headers("admin"),
      body: JSON.stringify({
        resourceType: "UPTIME_MONITOR",
        resourceId: "mon_sp",
        displayName: "Public API",
      }),
    });

    const preview = await app.request(`${base()}/${pageId}/preview`, {
      headers: { Authorization: tokens.member },
    });
    expect(preview.status).toBe(200);
    expect(preview.headers.get("content-type")).toContain("text/html");
    const body = await preview.text();
    expect(body).toContain("Acme Status");
    expect(body).toContain("Public API");
    expect(body).not.toContain('http-equiv="refresh"');
    expect(body).not.toContain("internal healthz");
    expect(body).not.toContain("internal.example.com");

    const ghost = await app.request(`${base()}/sp_ghost/preview`, {
      headers: { Authorization: tokens.member },
    });
    expect(ghost.status).toBe(404);
  });
});
