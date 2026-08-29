import type { Hono } from "hono";
import { buildApp } from "../../app";
import type { Subscription } from "../../domain/billing/types";
import type { Incident } from "../../domain/incidents/types";
import type { User } from "../../domain/users/types";
import type { Role, Workspace } from "../../domain/workspaces/types";
import { issueAccessToken } from "../../infrastructure/auth/jwt";
import { D1IncidentRepo } from "../../infrastructure/db/incident_repo";
import { D1MemberRepo } from "../../infrastructure/db/member_repo";
import { D1SubscriptionRepo } from "../../infrastructure/db/subscription_repo";
import { D1UserRepo } from "../../infrastructure/db/user_repo";
import { D1WorkspaceRepo } from "../../infrastructure/db/workspace_repo";
import { FixedClock } from "../../shared/clock";
import { loadConfig } from "../../shared/config";
import { FakeIds } from "../../test/fakes/ids";
import { freshDb, freshKv, testEnv } from "../../test/helpers";
import type { AppEnv } from "../env";

type Actor = "admin" | "member";
const NOW = Date.now();
const USERS: Record<Actor, User> = {
  admin: {
    id: "usr_iu_admin",
    name: "IU Admin",
    email: "iu-admin@zenguy.test",
    passwordHash: "unused",
    emailVerifiedAt: NOW,
    authVersion: 1,
    createdAt: NOW,
    updatedAt: NOW,
  },
  member: {
    id: "usr_iu_member",
    name: "IU Member",
    email: "iu-member@zenguy.test",
    passwordHash: "unused",
    emailVerifiedAt: NOW,
    authVersion: 1,
    createdAt: NOW,
    updatedAt: NOW,
  },
};
const ROLES: Record<Actor, Role> = { admin: "ADMIN", member: "MEMBER" };
const WORKSPACE: Workspace = {
  id: "ws_iu_routes",
  name: "Incident Updates",
  slug: "incident-updates",
  timezone: "UTC",
  ownerUserId: USERS.admin.id,
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
};

const SUBSCRIPTION: Subscription = {
  id: "sub_iu",
  workspaceId: WORKSPACE.id,
  provider: "paddle",
  providerCustomerId: "ctm_iu",
  providerSubscriptionId: "psub_iu",
  status: "ACTIVE",
  periodStart: NOW - 86_400_000,
  periodEnd: NOW + 30 * 86_400_000,
  cancelAtPeriodEnd: false,
  updatePaymentUrl: null,
  cancelUrl: null,
  createdAt: NOW,
  updatedAt: NOW,
};

function incident(id: string, workspaceId = WORKSPACE.id): Incident {
  return {
    id,
    workspaceId,
    resourceType: "UPTIME_MONITOR",
    browserTestId: null,
    uptimeMonitorId: `mon_${id}`,
    status: "OPEN",
    openedAt: NOW - 3_600_000,
    resolvedAt: null,
    openedByRunId: null,
    resolvedByRunId: null,
    openedByCheckId: `chk_${id}`,
    resolvedByCheckId: null,
    lastEventAt: NOW - 3_600_000,
    createdAt: NOW - 3_600_000,
  };
}

describe("incident update routes", () => {
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
    let sequence = 0;
    for (const actor of ["admin", "member"] as const) {
      sequence += 1;
      await members.insert({
        id: `mem_iu_${sequence}`,
        workspaceId: WORKSPACE.id,
        userId: USERS[actor].id,
        role: ROLES[actor],
        invitedBy: null,
        joinedAt: NOW + sequence,
      });
    }
    await new D1SubscriptionRepo(bindings.DB).upsertByWorkspace(SUBSCRIPTION);
    const incidents = new D1IncidentRepo(bindings.DB);
    await incidents.insertOpen(incident("inc_iu"));
    const clock = new FixedClock(NOW);
    tokens = {
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

  function updatesPath(incidentId: string, workspaceId = WORKSPACE.id): string {
    return `/api/workspaces/${workspaceId}/incidents/${incidentId}/updates`;
  }

  it("posts, lists and deletes public updates with role gating", async () => {
    const posted = await app.request(updatesPath("inc_iu"), {
      method: "POST",
      headers: headers("admin"),
      body: JSON.stringify({ message: "  We are investigating.  " }),
    });
    expect(posted.status).toBe(201);
    const postedBody = (await posted.json()) as {
      data: { id: string; message: string };
    };
    expect(postedBody.data.message).toBe("We are investigating.");

    const memberPost = await app.request(updatesPath("inc_iu"), {
      method: "POST",
      headers: headers("member"),
      body: JSON.stringify({ message: "Nope" }),
    });
    expect(memberPost.status).toBe(403);

    const memberList = await app.request(updatesPath("inc_iu"), {
      headers: headers("member"),
    });
    expect(memberList.status).toBe(200);
    const listBody = (await memberList.json()) as {
      data: { id: string; createdAt: string }[];
    };
    expect(listBody.data).toHaveLength(1);
    expect(listBody.data[0]?.createdAt).toBe(new Date(NOW).toISOString());

    const memberDelete = await app.request(
      `${updatesPath("inc_iu")}/${postedBody.data.id}`,
      { method: "DELETE", headers: headers("member") },
    );
    expect(memberDelete.status).toBe(403);

    const deleted = await app.request(
      `${updatesPath("inc_iu")}/${postedBody.data.id}`,
      { method: "DELETE", headers: headers("admin") },
    );
    expect(deleted.status).toBe(200);
    const relisted = await app.request(updatesPath("inc_iu"), {
      headers: headers("admin"),
    });
    await expect(relisted.json()).resolves.toMatchObject({ data: [] });
  });

  it("returns 404 for unknown incidents and oversized messages get 400", async () => {
    const unknown = await app.request(updatesPath("inc_ghost"), {
      method: "POST",
      headers: headers("admin"),
      body: JSON.stringify({ message: "Hello" }),
    });
    expect(unknown.status).toBe(404);

    const tooLong = await app.request(updatesPath("inc_iu"), {
      method: "POST",
      headers: headers("admin"),
      body: JSON.stringify({ message: "x".repeat(2_001) }),
    });
    expect(tooLong.status).toBe(400);
  });
});
