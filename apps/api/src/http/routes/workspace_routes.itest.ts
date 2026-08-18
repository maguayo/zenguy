import type { Hono } from "hono";
import { buildApp } from "../../app";
import type { User } from "../../domain/users/types";
import { issueAccessToken } from "../../infrastructure/auth/jwt";
import { D1AuditRepo } from "../../infrastructure/db/audit_repo";
import { D1MemberRepo } from "../../infrastructure/db/member_repo";
import { D1UserRepo } from "../../infrastructure/db/user_repo";
import { systemClock } from "../../shared/clock";
import { loadConfig } from "../../shared/config";
import { freshDb, testEnv } from "../../test/helpers";
import type { AppEnv } from "../env";

interface WorkspaceJson {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  subscriptionStatus: "NONE";
  createdAt: string;
}

const USERS: Record<"owner" | "member" | "outsider", User> = {
  owner: {
    id: "usr_workspace_owner",
    name: "Owner",
    email: "owner@workspace.test",
    passwordHash: "hash",
    emailVerifiedAt: 1,
    createdAt: 1_000,
    updatedAt: 1_000,
  },
  member: {
    id: "usr_workspace_member",
    name: "Member",
    email: "member@workspace.test",
    passwordHash: "hash",
    emailVerifiedAt: 1,
    createdAt: 1_000,
    updatedAt: 1_000,
  },
  outsider: {
    id: "usr_workspace_outsider",
    name: "Outsider",
    email: "outsider@workspace.test",
    passwordHash: "hash",
    emailVerifiedAt: 1,
    createdAt: 1_000,
    updatedAt: 1_000,
  },
};

function jsonRequest(body: object, authorization: string): RequestInit {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: authorization,
      "CF-Connecting-IP": "203.0.113.20",
    },
    body: JSON.stringify(body),
  };
}

describe("workspace routes", () => {
  let app: Hono<AppEnv>;
  let users: D1UserRepo;
  let members: D1MemberRepo;
  let audits: D1AuditRepo;
  let tokens: Record<keyof typeof USERS, string>;

  beforeEach(async () => {
    await freshDb();
    const bindings = testEnv();
    users = new D1UserRepo(bindings.DB);
    members = new D1MemberRepo(bindings.DB);
    audits = new D1AuditRepo(bindings.DB);
    for (const user of Object.values(USERS)) await users.insert(user);
    const config = loadConfig(bindings);
    tokens = {
      owner: `Bearer ${await issueAccessToken(config, USERS.owner, systemClock)}`,
      member: `Bearer ${await issueAccessToken(config, USERS.member, systemClock)}`,
      outsider: `Bearer ${await issueAccessToken(config, USERS.outsider, systemClock)}`,
    };
    app = buildApp(bindings);
  });

  async function createWorkspace(): Promise<WorkspaceJson> {
    const response = await app.request(
      "/api/workspaces",
      jsonRequest(
        { name: "  Acme Team  ", timezone: "Europe/Madrid" },
        tokens.owner,
      ),
    );
    expect(response.status).toBe(201);
    return ((await response.json()) as { data: WorkspaceJson }).data;
  }

  it("creates an owner workspace, audits it, and serves get/list/update", async () => {
    const created = await createWorkspace();
    expect(created).toMatchObject({
      name: "Acme Team",
      slug: "acme-team",
      timezone: "Europe/Madrid",
      role: "OWNER",
      subscriptionStatus: "NONE",
    });
    expect(Number.isNaN(Date.parse(created.createdAt))).toBe(false);
    await expect(members.find(created.id, USERS.owner.id)).resolves.toMatchObject(
      { role: "OWNER", invitedBy: null },
    );

    const listResponse = await app.request("/api/workspaces", {
      headers: { Authorization: tokens.owner },
    });
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual({ data: [created] });

    const getResponse = await app.request(`/api/workspaces/${created.id}`, {
      headers: { Authorization: tokens.owner },
    });
    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toEqual({ data: created });

    const updateResponse = await app.request(
      `/api/workspaces/${created.id}`,
      {
        ...jsonRequest(
          { name: "Renamed Team", timezone: "UTC" },
          tokens.owner,
        ),
        method: "PATCH",
      },
    );
    expect(updateResponse.status).toBe(200);
    await expect(updateResponse.json()).resolves.toMatchObject({
      data: { name: "Renamed Team", timezone: "UTC", role: "OWNER" },
    });

    const entries = await audits.list(created.id, null, 10);
    expect(entries.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(["workspace.created", "workspace.updated"]),
    );
    const updateAudit = entries.find(
      (entry) => entry.action === "workspace.updated",
    );
    expect(JSON.parse(updateAudit?.metadataJson ?? "null")).toEqual({
      changedFields: ["name", "timezone"],
    });
  });

  it("returns a field validation error for an invalid timezone", async () => {
    const response = await app.request(
      "/api/workspaces",
      jsonRequest(
        { name: "Acme", timezone: "Mars/Olympus_Mons" },
        tokens.owner,
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request",
        details: [{ field: "timezone", message: "Invalid timezone" }],
      },
    });
  });

  it("allows member reads, rejects member updates, and hides from non-members", async () => {
    const created = await createWorkspace();
    await members.insert({
      id: "mem_workspace_member",
      workspaceId: created.id,
      userId: USERS.member.id,
      role: "MEMBER",
      invitedBy: USERS.owner.id,
      joinedAt: Date.now(),
    });

    const memberGet = await app.request(`/api/workspaces/${created.id}`, {
      headers: { Authorization: tokens.member },
    });
    expect(memberGet.status).toBe(200);
    await expect(memberGet.json()).resolves.toMatchObject({
      data: { id: created.id, role: "MEMBER" },
    });

    const memberPatch = await app.request(
      `/api/workspaces/${created.id}`,
      {
        ...jsonRequest({ name: "Forbidden rename" }, tokens.member),
        method: "PATCH",
      },
    );
    expect(memberPatch.status).toBe(403);
    await expect(memberPatch.json()).resolves.toMatchObject({
      error: { code: "FORBIDDEN" },
    });

    const outsiderGet = await app.request(`/api/workspaces/${created.id}`, {
      headers: { Authorization: tokens.outsider },
    });
    expect(outsiderGet.status).toBe(404);
    await expect(outsiderGet.json()).resolves.toMatchObject({
      error: { code: "NOT_FOUND" },
    });
  });
});
