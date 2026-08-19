import type { Hono } from "hono";
import { buildApp } from "../../app";
import type { User } from "../../domain/users/types";
import type { Role, Workspace } from "../../domain/workspaces/types";
import { issueAccessToken } from "../../infrastructure/auth/jwt";
import { D1AuditRepo } from "../../infrastructure/db/audit_repo";
import { D1MemberRepo } from "../../infrastructure/db/member_repo";
import { D1UserRepo } from "../../infrastructure/db/user_repo";
import { D1WorkspaceRepo } from "../../infrastructure/db/workspace_repo";
import { systemClock } from "../../shared/clock";
import { loadConfig } from "../../shared/config";
import { freshDb, testEnv } from "../../test/helpers";
import type { AppEnv } from "../env";

type Actor = "owner" | "admin" | "member";

const USERS: Record<Actor | "target", User> = {
  owner: {
    id: "usr_members_owner",
    name: "Owner",
    email: "owner@members.test",
    passwordHash: "hash",
    emailVerifiedAt: 1,
    createdAt: 1_000,
    updatedAt: 1_000,
  },
  admin: {
    id: "usr_members_admin",
    name: "Admin",
    email: "admin@members.test",
    passwordHash: "hash",
    emailVerifiedAt: 1,
    createdAt: 1_000,
    updatedAt: 1_000,
  },
  member: {
    id: "usr_members_member",
    name: "Member",
    email: "member@members.test",
    passwordHash: "hash",
    emailVerifiedAt: 1,
    createdAt: 1_000,
    updatedAt: 1_000,
  },
  target: {
    id: "usr_members_target",
    name: "Target",
    email: "target@members.test",
    passwordHash: "hash",
    emailVerifiedAt: 1,
    createdAt: 1_000,
    updatedAt: 1_000,
  },
};

const WORKSPACE: Workspace = {
  id: "ws_members",
  name: "Members Workspace",
  slug: "members-workspace",
  timezone: "UTC",
  ownerUserId: USERS.owner.id,
  createdAt: 1_000,
  updatedAt: 1_000,
  deletedAt: null,
};

const ACTOR_ROLES: Record<Actor, Role> = {
  owner: "OWNER",
  admin: "ADMIN",
  member: "MEMBER",
};

describe("member routes", () => {
  let app: Hono<AppEnv>;
  let members: D1MemberRepo;
  let audits: D1AuditRepo;
  let tokens: Record<Actor, string>;

  beforeEach(async () => {
    await freshDb();
    const bindings = testEnv();
    const users = new D1UserRepo(bindings.DB);
    const workspaces = new D1WorkspaceRepo(bindings.DB);
    members = new D1MemberRepo(bindings.DB);
    audits = new D1AuditRepo(bindings.DB);
    for (const user of Object.values(USERS)) await users.insert(user);
    await workspaces.insert(WORKSPACE);
    let sequence = 0;
    for (const actor of ["owner", "admin", "member"] as const) {
      sequence += 1;
      await members.insert({
        id: `mem_actor_${sequence}`,
        workspaceId: WORKSPACE.id,
        userId: USERS[actor].id,
        role: ACTOR_ROLES[actor],
        invitedBy: actor === "owner" ? null : USERS.owner.id,
        joinedAt: 1_000 + sequence,
      });
    }
    await members.insert({
      id: "mem_target",
      workspaceId: WORKSPACE.id,
      userId: USERS.target.id,
      role: "MEMBER",
      invitedBy: USERS.owner.id,
      joinedAt: 2_000,
    });
    const config = loadConfig(bindings);
    tokens = {
      owner: `Bearer ${await issueAccessToken(config, USERS.owner, systemClock)}`,
      admin: `Bearer ${await issueAccessToken(config, USERS.admin, systemClock)}`,
      member: `Bearer ${await issueAccessToken(config, USERS.member, systemClock)}`,
    };
    app = buildApp(bindings);
  });

  function authorization(actor: Actor): HeadersInit {
    return { Authorization: tokens[actor] };
  }

  it.each(["owner", "admin", "member"] as const)(
    "%s can list members",
    async (actor) => {
      const response = await app.request(
        `/api/workspaces/${WORKSPACE.id}/members`,
        { headers: authorization(actor) },
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        data: { userId: string; joinedAt: string }[];
      };
      expect(body.data).toHaveLength(4);
      expect(body.data.map((member) => member.userId)).toContain(
        USERS.target.id,
      );
      expect(body.data.every((member) => !Number.isNaN(Date.parse(member.joinedAt)))).toBe(
        true,
      );
    },
  );

  it.each([
    ["owner", 200],
    ["admin", 403],
    ["member", 403],
  ] as const)("%s receives %s when changing a role", async (actor, expected) => {
    const response = await app.request(
      `/api/workspaces/${WORKSPACE.id}/members/${USERS.target.id}`,
      {
        method: "PATCH",
        headers: {
          ...authorization(actor),
          "content-type": "application/json",
        },
        body: JSON.stringify({ role: "ADMIN" }),
      },
    );

    expect(response.status).toBe(expected);
    if (expected === 200) {
      await expect(response.json()).resolves.toMatchObject({
        data: { userId: USERS.target.id, role: "ADMIN" },
      });
      await expect(
        audits.list(WORKSPACE.id, null, 10),
      ).resolves.toEqual([
        expect.objectContaining({ action: "member.role_changed" }),
      ]);
    }
  });

  it.each([
    ["owner", 204],
    ["admin", 204],
    ["member", 403],
  ] as const)("%s receives %s when removing a member", async (actor, expected) => {
    const response = await app.request(
      `/api/workspaces/${WORKSPACE.id}/members/${USERS.target.id}`,
      { method: "DELETE", headers: authorization(actor) },
    );

    expect(response.status).toBe(expected);
    if (expected === 204) {
      await expect(
        members.find(WORKSPACE.id, USERS.target.id),
      ).resolves.toBeNull();
      await expect(
        audits.list(WORKSPACE.id, null, 10),
      ).resolves.toEqual([
        expect.objectContaining({ action: "member.removed" }),
      ]);
    }
  });

  it("prevents changing or removing the owner", async () => {
    const change = await app.request(
      `/api/workspaces/${WORKSPACE.id}/members/${USERS.owner.id}`,
      {
        method: "PATCH",
        headers: {
          ...authorization("owner"),
          "content-type": "application/json",
        },
        body: JSON.stringify({ role: "MEMBER" }),
      },
    );
    expect(change.status).toBe(403);

    const removeByAdmin = await app.request(
      `/api/workspaces/${WORKSPACE.id}/members/${USERS.owner.id}`,
      { method: "DELETE", headers: authorization("admin") },
    );
    expect(removeByAdmin.status).toBe(403);
    await expect(removeByAdmin.json()).resolves.toMatchObject({
      error: { code: "FORBIDDEN", message: "The owner cannot be removed" },
    });
  });

  it("prevents self-removal and an admin removing another admin", async () => {
    const selfRemoval = await app.request(
      `/api/workspaces/${WORKSPACE.id}/members/${USERS.admin.id}`,
      { method: "DELETE", headers: authorization("admin") },
    );
    expect(selfRemoval.status).toBe(403);
    await expect(selfRemoval.json()).resolves.toMatchObject({
      error: { message: "You cannot remove yourself" },
    });

    await members.updateRole(WORKSPACE.id, USERS.target.id, "ADMIN");
    const adminRemoval = await app.request(
      `/api/workspaces/${WORKSPACE.id}/members/${USERS.target.id}`,
      { method: "DELETE", headers: authorization("admin") },
    );
    expect(adminRemoval.status).toBe(403);
    await expect(adminRemoval.json()).resolves.toMatchObject({
      error: { message: "Only the owner can remove admins" },
    });
  });
});
