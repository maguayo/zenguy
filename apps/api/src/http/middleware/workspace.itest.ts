import type { Hono } from "hono";
import { buildApp } from "../../app";
import type { User } from "../../domain/users/types";
import type {
  Role,
  Workspace,
  WorkspaceMember,
} from "../../domain/workspaces/types";
import { issueAccessToken } from "../../infrastructure/auth/jwt";
import { D1MemberRepo } from "../../infrastructure/db/member_repo";
import { D1UserRepo } from "../../infrastructure/db/user_repo";
import { D1WorkspaceRepo } from "../../infrastructure/db/workspace_repo";
import { systemClock } from "../../shared/clock";
import { loadConfig } from "../../shared/config";
import { freshDb, testEnv } from "../../test/helpers";
import type { AppEnv } from "../env";
import { requireAuth } from "./auth";
import { requireAction, withWorkspace } from "./workspace";

const USERS: Record<"owner" | "admin" | "member" | "outsider", User> = {
  owner: {
    id: "usr_owner",
    name: "Owner",
    email: "owner@example.com",
    passwordHash: "hash",
    emailVerifiedAt: 1,
    createdAt: 1_000,
    updatedAt: 1_000,
  },
  admin: {
    id: "usr_admin",
    name: "Admin",
    email: "admin@example.com",
    passwordHash: "hash",
    emailVerifiedAt: 1,
    createdAt: 1_000,
    updatedAt: 1_000,
  },
  member: {
    id: "usr_member",
    name: "Member",
    email: "member@example.com",
    passwordHash: "hash",
    emailVerifiedAt: 1,
    createdAt: 1_000,
    updatedAt: 1_000,
  },
  outsider: {
    id: "usr_outsider",
    name: "Other Owner",
    email: "other@example.com",
    passwordHash: "hash",
    emailVerifiedAt: 1,
    createdAt: 1_000,
    updatedAt: 1_000,
  },
};

const PRIMARY: Workspace = {
  id: "ws_primary",
  name: "Primary",
  slug: "primary",
  timezone: "UTC",
  ownerUserId: USERS.owner.id,
  createdAt: 1_000,
  updatedAt: 1_000,
  deletedAt: null,
};

const OTHER: Workspace = {
  ...PRIMARY,
  id: "ws_other",
  name: "Other",
  slug: "other",
  ownerUserId: USERS.outsider.id,
};

function membership(
  id: string,
  workspaceId: string,
  userId: string,
  role: Role,
): WorkspaceMember {
  return {
    id,
    workspaceId,
    userId,
    role,
    invitedBy: null,
    joinedAt: 1_000,
  };
}

async function bearer(user: User): Promise<string> {
  return `Bearer ${await issueAccessToken(loadConfig(testEnv()), user, systemClock)}`;
}

async function status(
  app: Hono<AppEnv>,
  user: User,
  workspaceId: string,
  probe: "view" | "manage" | "delete",
): Promise<number> {
  const response = await app.request(
    `/api/workspaces/${workspaceId}/_probe/${probe}`,
    { headers: { Authorization: await bearer(user) } },
  );
  return response.status;
}

describe("workspace middleware", () => {
  let app: Hono<AppEnv>;

  beforeEach(async () => {
    await freshDb();
    const bindings = testEnv();
    const users = new D1UserRepo(bindings.DB);
    const workspaces = new D1WorkspaceRepo(bindings.DB);
    const members = new D1MemberRepo(bindings.DB);
    for (const user of Object.values(USERS)) await users.insert(user);
    await workspaces.insert(PRIMARY);
    await workspaces.insert(OTHER);
    await members.insert(
      membership("mem_owner", PRIMARY.id, USERS.owner.id, "OWNER"),
    );
    await members.insert(
      membership("mem_admin", PRIMARY.id, USERS.admin.id, "ADMIN"),
    );
    await members.insert(
      membership("mem_member", PRIMARY.id, USERS.member.id, "MEMBER"),
    );
    await members.insert(
      membership("mem_other", OTHER.id, USERS.outsider.id, "OWNER"),
    );

    app = buildApp(bindings);
    const auth = requireAuth({ users, config: loadConfig(bindings) });
    const workspace = withWorkspace({ workspaces, members });
    app.get(
      "/api/workspaces/:workspaceId/_probe/view",
      auth,
      workspace,
      requireAction("tests.view"),
      (context) => context.json({ data: { role: context.get("role") } }),
    );
    app.get(
      "/api/workspaces/:workspaceId/_probe/manage",
      auth,
      workspace,
      requireAction("workspace.settings"),
      (context) => context.json({ data: { role: context.get("role") } }),
    );
    app.get(
      "/api/workspaces/:workspaceId/_probe/delete",
      auth,
      workspace,
      requireAction("workspace.delete"),
      (context) => context.json({ data: { role: context.get("role") } }),
    );
  });

  it("applies member, admin, and owner guards exactly", async () => {
    await expect(
      Promise.all([
        status(app, USERS.owner, PRIMARY.id, "view"),
        status(app, USERS.owner, PRIMARY.id, "manage"),
        status(app, USERS.owner, PRIMARY.id, "delete"),
      ]),
    ).resolves.toEqual([200, 200, 200]);
    await expect(
      Promise.all([
        status(app, USERS.admin, PRIMARY.id, "view"),
        status(app, USERS.admin, PRIMARY.id, "manage"),
        status(app, USERS.admin, PRIMARY.id, "delete"),
      ]),
    ).resolves.toEqual([200, 200, 403]);
    await expect(
      Promise.all([
        status(app, USERS.member, PRIMARY.id, "view"),
        status(app, USERS.member, PRIMARY.id, "manage"),
        status(app, USERS.member, PRIMARY.id, "delete"),
      ]),
    ).resolves.toEqual([200, 403, 403]);
  });

  it("returns 404 to a non-member without revealing the workspace", async () => {
    const response = await app.request(
      `/api/workspaces/${PRIMARY.id}/_probe/view`,
      { headers: { Authorization: await bearer(USERS.outsider) } },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "NOT_FOUND", message: "Workspace not found" },
    });
    await expect(
      status(app, USERS.outsider, OTHER.id, "delete"),
    ).resolves.toBe(200);
  });

  it("treats soft-deleted and missing workspaces identically", async () => {
    await new D1WorkspaceRepo(testEnv().DB).softDelete(PRIMARY.id, 2_000);

    await expect(status(app, USERS.owner, PRIMARY.id, "view")).resolves.toBe(
      404,
    );
    await expect(status(app, USERS.owner, "ws_missing", "view")).resolves.toBe(
      404,
    );
  });
});
