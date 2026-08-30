import type { Hono } from "hono";
import { buildApp } from "../../app";
import type { Subscription } from "../../domain/billing/types";
import type { User } from "../../domain/users/types";
import type { Role, Workspace } from "../../domain/workspaces/types";
import { issueAccessToken } from "../../infrastructure/auth/jwt";
import { D1MemberRepo } from "../../infrastructure/db/member_repo";
import { D1SubscriptionRepo } from "../../infrastructure/db/subscription_repo";
import { D1UserRepo } from "../../infrastructure/db/user_repo";
import { D1WorkspaceRepo } from "../../infrastructure/db/workspace_repo";
import { FixedClock } from "../../shared/clock";
import { loadConfig } from "../../shared/config";
import {
  FakeCnameResolver,
  FakeCustomHostnameClient,
} from "../../test/fakes/custom_hostnames";
import { FakeIds } from "../../test/fakes/ids";
import { freshDb, freshKv, testEnv } from "../../test/helpers";
import type { AppEnv } from "../env";

type Actor = "admin" | "member";
const NOW = Date.now();
const USERS: Record<Actor, User> = {
  admin: {
    id: "usr_cd_admin",
    name: "CD Admin",
    email: "cd-admin@zenguy.test",
    passwordHash: "unused",
    emailVerifiedAt: NOW,
    authVersion: 1,
    createdAt: NOW,
    updatedAt: NOW,
  },
  member: {
    id: "usr_cd_member",
    name: "CD Member",
    email: "cd-member@zenguy.test",
    passwordHash: "unused",
    emailVerifiedAt: NOW,
    authVersion: 1,
    createdAt: NOW,
    updatedAt: NOW,
  },
};
const ROLES: Record<Actor, Role> = { admin: "ADMIN", member: "MEMBER" };
const WORKSPACE: Workspace = {
  id: "ws_cd_routes",
  name: "Custom Domains",
  slug: "custom-domains",
  timezone: "UTC",
  ownerUserId: USERS.admin.id,
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
};
const SUBSCRIPTION: Subscription = {
  id: "sub_cd",
  workspaceId: WORKSPACE.id,
  provider: "paddle",
  providerCustomerId: "ctm_cd",
  providerSubscriptionId: "psub_cd",
  status: "ACTIVE",
  periodStart: NOW - 86_400_000,
  periodEnd: NOW + 30 * 86_400_000,
  cancelAtPeriodEnd: false,
  updatePaymentUrl: null,
  cancelUrl: null,
  createdAt: NOW,
  updatedAt: NOW,
};

describe("status page custom domain routes", () => {
  let app: Hono<AppEnv>;
  let tokens: Record<Actor, string>;
  let client: FakeCustomHostnameClient;
  let resolver: FakeCnameResolver;

  async function seed(): Promise<void> {
    await Promise.all([freshDb(), freshKv()]);
    const bindings = testEnv();
    const config = loadConfig(bindings);
    const users = new D1UserRepo(bindings.DB);
    const workspaces = new D1WorkspaceRepo(bindings.DB);
    const members = new D1MemberRepo(bindings.DB);
    for (const user of Object.values(USERS)) await users.insert(user);
    await workspaces.insert(WORKSPACE);
    let sequence = 0;
    for (const actor of ["admin", "member"] as const) {
      sequence += 1;
      await members.insert({
        id: `mem_cd_${sequence}`,
        workspaceId: WORKSPACE.id,
        userId: USERS[actor].id,
        role: ROLES[actor],
        invitedBy: null,
        joinedAt: NOW + sequence,
      });
    }
    await new D1SubscriptionRepo(bindings.DB).upsertByWorkspace(SUBSCRIPTION);
    const clock = new FixedClock(NOW);
    tokens = {
      admin: `Bearer ${await issueAccessToken(config, USERS.admin, clock)}`,
      member: `Bearer ${await issueAccessToken(config, USERS.member, clock)}`,
    };
  }

  function buildWith(overrides: Parameters<typeof buildApp>[1]): void {
    app = buildApp(testEnv(), {
      clock: new FixedClock(NOW),
      ids: new FakeIds(),
      ...overrides,
    });
  }

  beforeEach(async () => {
    await seed();
    client = new FakeCustomHostnameClient();
    resolver = new FakeCnameResolver();
    buildWith({
      customHostnames: client,
      cnameResolver: resolver,
      statusCnameTarget: "customers.zenguy.com",
    });
  });

  function headers(actor: Actor): HeadersInit {
    return {
      Authorization: tokens[actor],
      "content-type": "application/json",
    };
  }

  async function createPage(slug: string): Promise<string> {
    const response = await app.request(
      `/api/workspaces/${WORKSPACE.id}/status-pages`,
      {
        method: "POST",
        headers: headers("admin"),
        body: JSON.stringify({ title: "Acme", slug }),
      },
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { data: { id: string } };
    return body.data.id;
  }

  function domainPath(pageId: string): string {
    return `/api/workspaces/${WORKSPACE.id}/status-pages/${pageId}/custom-domain`;
  }

  it("connects, checks and removes a custom domain", async () => {
    const pageId = await createPage("acme");

    const connected = await app.request(domainPath(pageId), {
      method: "PUT",
      headers: headers("admin"),
      body: JSON.stringify({ hostname: "Status.Example.com" }),
    });
    expect(connected.status).toBe(200);
    const connectedBody = (await connected.json()) as {
      data: { customDomain: { hostname: string; status: string } };
    };
    expect(connectedBody.data.customDomain).toMatchObject({
      hostname: "status.example.com",
      status: "PENDING",
    });
    expect(client.records.size).toBe(1);

    // DNS still points nowhere.
    const pendingCheck = await app.request(`${domainPath(pageId)}/check`, {
      method: "POST",
      headers: headers("admin"),
    });
    expect(pendingCheck.status).toBe(200);
    await expect(pendingCheck.json()).resolves.toMatchObject({
      data: {
        domain: "status.example.com",
        status: "PENDING",
        cnameTarget: "customers.zenguy.com",
        cname: { found: false, correct: false, value: null },
      },
    });

    // CNAME lands and Cloudflare finishes validation.
    resolver.answers.set("status.example.com", "customers.zenguy.com");
    const record = [...client.records.values()][0];
    if (record !== undefined) {
      record.status = "active";
      record.sslStatus = "active";
    }
    const activeCheck = await app.request(`${domainPath(pageId)}/check`, {
      method: "POST",
      headers: headers("admin"),
    });
    await expect(activeCheck.json()).resolves.toMatchObject({
      data: {
        status: "ACTIVE",
        cname: { found: true, correct: true, value: "customers.zenguy.com" },
      },
    });

    const detail = await app.request(
      `/api/workspaces/${WORKSPACE.id}/status-pages/${pageId}`,
      { headers: headers("member") },
    );
    await expect(detail.json()).resolves.toMatchObject({
      data: { customDomain: { hostname: "status.example.com", status: "ACTIVE" } },
    });

    const removed = await app.request(domainPath(pageId), {
      method: "DELETE",
      headers: headers("admin"),
    });
    expect(removed.status).toBe(200);
    expect(client.removed).toHaveLength(1);
    const cleared = await app.request(
      `/api/workspaces/${WORKSPACE.id}/status-pages/${pageId}`,
      { headers: headers("admin") },
    );
    await expect(cleared.json()).resolves.toMatchObject({
      data: { customDomain: null },
    });
  });

  it("enforces roles, uniqueness and validation", async () => {
    const pageId = await createPage("acme");
    const otherId = await createPage("acme-two");

    const memberPut = await app.request(domainPath(pageId), {
      method: "PUT",
      headers: headers("member"),
      body: JSON.stringify({ hostname: "status.example.com" }),
    });
    expect(memberPut.status).toBe(403);

    const invalid = await app.request(domainPath(pageId), {
      method: "PUT",
      headers: headers("admin"),
      body: JSON.stringify({ hostname: "status.zenguy.com" }),
    });
    expect(invalid.status).toBe(400);

    const first = await app.request(domainPath(pageId), {
      method: "PUT",
      headers: headers("admin"),
      body: JSON.stringify({ hostname: "status.example.com" }),
    });
    expect(first.status).toBe(200);

    const duplicate = await app.request(domainPath(otherId), {
      method: "PUT",
      headers: headers("admin"),
      body: JSON.stringify({ hostname: "status.example.com" }),
    });
    expect(duplicate.status).toBe(409);

    const checkWithout = await app.request(`${domainPath(otherId)}/check`, {
      method: "POST",
      headers: headers("admin"),
    });
    expect(checkWithout.status).toBe(404);
  });

  it("returns 503 when custom domains are not configured", async () => {
    buildWith({ customHostnames: null });
    const pageId = await createPage("acme");
    const response = await app.request(domainPath(pageId), {
      method: "PUT",
      headers: headers("admin"),
      body: JSON.stringify({ hostname: "status.example.com" }),
    });
    expect(response.status).toBe(503);
  });
});
