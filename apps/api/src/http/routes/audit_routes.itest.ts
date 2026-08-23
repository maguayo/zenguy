import { buildApp } from "../../app";
import type { Subscription } from "../../domain/billing/types";
import type { User } from "../../domain/users/types";
import type { Role, Workspace } from "../../domain/workspaces/types";
import { issueAccessToken } from "../../infrastructure/auth/jwt";
import { D1MemberRepo } from "../../infrastructure/db/member_repo";
import { D1SubscriptionRepo } from "../../infrastructure/db/subscription_repo";
import { D1UserRepo } from "../../infrastructure/db/user_repo";
import { D1WorkspaceRepo } from "../../infrastructure/db/workspace_repo";
import { FixedClock, systemClock } from "../../shared/clock";
import { loadConfig } from "../../shared/config";
import { FakeIds } from "../../test/fakes/ids";
import { freshDb, testEnv } from "../../test/helpers";

type Actor = "owner" | "admin" | "member";
const NOW = Date.parse("2026-08-19T09:00:00.000Z");
const USERS: Record<Actor, User> = {
  owner: {
    id: "usr_audit_owner",
    name: "Audit Owner",
    email: "owner@audit-route.test",
    passwordHash: "unused",
    emailVerifiedAt: NOW,
    authVersion: 1,
    createdAt: NOW,
    updatedAt: NOW,
  },
  admin: {
    id: "usr_audit_admin",
    name: "Audit Admin",
    email: "admin@audit-route.test",
    passwordHash: "unused",
    emailVerifiedAt: NOW,
    authVersion: 1,
    createdAt: NOW,
    updatedAt: NOW,
  },
  member: {
    id: "usr_audit_member",
    name: "Audit Member",
    email: "member@audit-route.test",
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
  id: "ws_audit_route",
  name: "Audit Route Workspace",
  slug: "audit-route-workspace",
  timezone: "UTC",
  ownerUserId: USERS.owner.id,
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
};
const SUBSCRIPTION: Subscription = {
  id: "sub_audit_route",
  workspaceId: WORKSPACE.id,
  provider: "paddle",
  providerCustomerId: "ctm_audit_route",
  providerSubscriptionId: "provider_sub_audit_route",
  status: "ACTIVE",
  periodStart: NOW - 1_000,
  periodEnd: NOW + 30 * 24 * 60 * 60 * 1_000,
  cancelAtPeriodEnd: false,
  updatePaymentUrl: null,
  cancelUrl: null,
  createdAt: NOW,
  updatedAt: NOW,
};

describe("audit log route", () => {
  it("allows owners/admins, rejects members, and paginates audited use-case writes", async () => {
    await freshDb();
    const bindings = testEnv();
    const users = new D1UserRepo(bindings.DB);
    const members = new D1MemberRepo(bindings.DB);
    for (const user of Object.values(USERS)) await users.insert(user);
    await new D1WorkspaceRepo(bindings.DB).insert(WORKSPACE);
    let membershipSequence = 0;
    for (const actor of ["owner", "admin", "member"] as const) {
      membershipSequence += 1;
      await members.insert({
        id: `mem_audit_route_${membershipSequence}`,
        workspaceId: WORKSPACE.id,
        userId: USERS[actor].id,
        role: ROLES[actor],
        invitedBy: actor === "owner" ? null : USERS.owner.id,
        joinedAt: NOW,
      });
    }
    await new D1SubscriptionRepo(bindings.DB).upsertByWorkspace(SUBSCRIPTION);
    const config = loadConfig(bindings);
    const tokens = Object.fromEntries(
      await Promise.all(
        (Object.keys(USERS) as Actor[]).map(async (actor) => [
          actor,
          await issueAccessToken(config, USERS[actor], systemClock),
        ]),
      ),
    ) as Record<Actor, string>;
    const app = buildApp(bindings, {
      clock: new FixedClock(NOW),
      ids: new FakeIds(),
    });
    const headers = (actor: Actor): HeadersInit => ({
      Authorization: `Bearer ${tokens[actor]}`,
      "content-type": "application/json",
    });

    const renamed = await app.request(`/api/workspaces/${WORKSPACE.id}`, {
      method: "PATCH",
      headers: {
        ...headers("owner"),
        "CF-Connecting-IP": "203.0.113.10",
      },
      body: JSON.stringify({ name: "Renamed Audit Workspace" }),
    });
    expect(renamed.status).toBe(200);
    const createdSecret = await app.request(
      `/api/workspaces/${WORKSPACE.id}/secrets`,
      {
        method: "POST",
        headers: {
          ...headers("admin"),
          "CF-Connecting-IP": "203.0.113.11",
        },
        body: JSON.stringify({
          key: "AUDIT_TOKEN",
          value: "never-return-this-value",
          allowedDomains: ["example.com"],
          description: "Audit endpoint fixture",
        }),
      },
    );
    expect(createdSecret.status).toBe(201);

    const unauthenticated = await app.request(
      `/api/workspaces/${WORKSPACE.id}/audit-logs`,
    );
    expect(unauthenticated.status).toBe(401);
    const forbidden = await app.request(
      `/api/workspaces/${WORKSPACE.id}/audit-logs`,
      { headers: headers("member") },
    );
    expect(forbidden.status).toBe(403);

    const first = await app.request(
      `/api/workspaces/${WORKSPACE.id}/audit-logs?limit=1`,
      { headers: headers("admin") },
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      data: Array<Record<string, unknown>>;
      nextCursor: string | null;
    };
    expect(firstBody).toMatchObject({
      data: [
        {
          action: "secret.created",
          actor: { userId: USERS.admin.id, name: USERS.admin.name },
          resourceType: "secret",
          metadata: {
            key: "AUDIT_TOKEN",
            domains: ["example.com"],
          },
          ip: "203.0.113.11",
          createdAt: "2026-08-19T09:00:00.000Z",
        },
      ],
      nextCursor: expect.any(String),
    });
    expect(JSON.stringify(firstBody)).not.toContain("never-return-this-value");

    const second = await app.request(
      `/api/workspaces/${WORKSPACE.id}/audit-logs?limit=1&cursor=${encodeURIComponent(firstBody.nextCursor ?? "")}`,
      { headers: headers("owner") },
    );
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({
      data: [
        {
          action: "workspace.updated",
          actor: { userId: USERS.owner.id, name: USERS.owner.name },
          resourceType: "workspace",
          resourceId: WORKSPACE.id,
          metadata: { changedFields: ["name"] },
          ip: "203.0.113.10",
          createdAt: "2026-08-19T09:00:00.000Z",
        },
      ],
      nextCursor: null,
    });
  });
});
