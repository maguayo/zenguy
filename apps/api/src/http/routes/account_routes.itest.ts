import type { Hono } from "hono";
import { buildApp } from "../../app";
import type { WorkspaceDeletionCoordinator } from "../../application/workspaces/delete_workspace";
import type { Workspace, WorkspaceMember } from "../../domain/workspaces/types";
import type { User } from "../../domain/users/types";
import { D1MemberRepo } from "../../infrastructure/db/member_repo";
import { D1UserRepo } from "../../infrastructure/db/user_repo";
import { D1WorkspaceRepo } from "../../infrastructure/db/workspace_repo";
import { hashPassword } from "../../shared/crypto";
import { freshDb, freshKv, testEnv } from "../../test/helpers";
import type { AppEnv } from "../env";

const NOW = 1_780_000_000_000;

class RecordingWorkspaceDeletion implements WorkspaceDeletionCoordinator {
  calls: string[] = [];

  async request(workspaceId: string): Promise<boolean> {
    this.calls.push(workspaceId);
    return true;
  }
}

function jsonRequest(body: object, token?: string): RequestInit {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "CF-Connecting-IP": "198.51.100.77",
      ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  };
}

function workspace(id: string, ownerUserId: string, createdAt: number): Workspace {
  return {
    id,
    name: id,
    slug: id,
    timezone: "UTC",
    ownerUserId,
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
  };
}

function membership(
  id: string,
  workspaceId: string,
  userId: string,
  role: WorkspaceMember["role"],
): WorkspaceMember {
  return { id, workspaceId, userId, role, invitedBy: null, joinedAt: NOW };
}

describe("account deletion route", () => {
  let app: Hono<AppEnv>;
  let deletion: RecordingWorkspaceDeletion;
  let actor: User;
  let accessToken: string;

  beforeEach(async () => {
    await freshDb();
    await freshKv();
    deletion = new RecordingWorkspaceDeletion();
    app = buildApp(testEnv(), { workspaceDeletion: deletion });

    actor = {
      id: "usr_delete_me",
      name: "Delete Me",
      email: "delete-me@example.com",
      passwordHash: await hashPassword("correct-password"),
      emailVerifiedAt: NOW - 1_000,
      authVersion: 1,
      createdAt: NOW - 10_000,
      updatedAt: NOW - 10_000,
    };
    const other = {
      ...actor,
      id: "usr_other",
      name: "Other Owner",
      email: "other@example.com",
    };
    const users = new D1UserRepo(testEnv().DB);
    await users.insert(actor);
    await users.insert(other);

    const workspaces = new D1WorkspaceRepo(testEnv().DB);
    const members = new D1MemberRepo(testEnv().DB);
    await workspaces.insert(workspace("ws_owned_a", actor.id, NOW - 3_000));
    await workspaces.insert(workspace("ws_joined", other.id, NOW - 2_000));
    await workspaces.insert(workspace("ws_owned_b", actor.id, NOW - 1_000));
    await members.insert(membership("mem_owned_a", "ws_owned_a", actor.id, "OWNER"));
    await members.insert(membership("mem_joined", "ws_joined", actor.id, "ADMIN"));
    await members.insert(membership("mem_other", "ws_joined", other.id, "OWNER"));
    await members.insert(membership("mem_owned_b", "ws_owned_b", actor.id, "OWNER"));

    const login = await app.request(
      "/api/auth/login",
      jsonRequest({ email: actor.email, password: "correct-password" }),
    );
    expect(login.status).toBe(200);
    accessToken = ((await login.json()) as { data: { accessToken: string } }).data.accessToken;
  });

  it("requires the password, removes every reachable account surface, and invalidates old tokens", async () => {
    const wrong = await app.request("/api/account", {
      ...jsonRequest({ confirmation: "DELETE", password: "wrong-password" }, accessToken),
      method: "DELETE",
    });
    expect(wrong.status).toBe(403);
    expect(await new D1UserRepo(testEnv().DB).findById(actor.id)).not.toBeNull();

    const response = await app.request("/api/account", {
      ...jsonRequest({ confirmation: "DELETE", password: "correct-password" }, accessToken),
      method: "DELETE",
      headers: {
        ...jsonRequest({}, accessToken).headers,
        "X-Zenguy-Client": "native",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(new Set(deletion.calls)).toEqual(new Set(["ws_owned_a", "ws_owned_b"]));

    const database = testEnv().DB;
    const user = await database
      .prepare("SELECT name, email, email_verified_at, deleted_at FROM users WHERE id = ?")
      .bind(actor.id)
      .first<{
        name: string;
        email: string;
        email_verified_at: number | null;
        deleted_at: number | null;
      }>();
    expect(user).toMatchObject({
      name: "Deleted user",
      email: `deleted+${actor.id}@redacted.invalid`,
      email_verified_at: null,
      deleted_at: expect.any(Number),
    });
    await expect(new D1UserRepo(database).findById(actor.id)).resolves.toBeNull();
    await expect(new D1UserRepo(database).findByEmail(actor.email)).resolves.toBeNull();

    const joinedMembership = await database
      .prepare("SELECT id FROM workspace_members WHERE id = 'mem_joined'")
      .first();
    const ownerMemberships = await database
      .prepare("SELECT id FROM workspace_members WHERE user_id = ? AND role = 'OWNER'")
      .bind(actor.id)
      .all();
    expect(joinedMembership).toBeNull();
    expect(ownerMemberships.results).toHaveLength(2);

    const activeRefreshTokens = await database
      .prepare("SELECT id FROM refresh_tokens WHERE user_id = ? AND revoked_at IS NULL")
      .bind(actor.id)
      .all();
    expect(activeRefreshTokens.results).toEqual([]);

    const oldSession = await app.request("/api/auth/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(oldSession.status).toBe(401);
    const relogin = await app.request(
      "/api/auth/login",
      jsonRequest({ email: actor.email, password: "correct-password" }),
    );
    expect(relogin.status).toBe(401);
  });
});
