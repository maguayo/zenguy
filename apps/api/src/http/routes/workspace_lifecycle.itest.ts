import type { Hono } from "hono";
import { buildApp } from "../../app";
import type { User } from "../../domain/users/types";
import type { Workspace } from "../../domain/workspaces/types";
import { issueAccessToken } from "../../infrastructure/auth/jwt";
import { D1AuditRepo } from "../../infrastructure/db/audit_repo";
import { D1InvitationRepo } from "../../infrastructure/db/invitation_repo";
import { D1MemberRepo } from "../../infrastructure/db/member_repo";
import { D1UserRepo } from "../../infrastructure/db/user_repo";
import { D1WorkspaceRepo } from "../../infrastructure/db/workspace_repo";
import { systemClock } from "../../shared/clock";
import { loadConfig } from "../../shared/config";
import { RecordingBillingCanceller } from "../../test/fakes/billing";
import { freshDb, testEnv } from "../../test/helpers";
import type { AppEnv } from "../env";

const USERS: Record<"owner" | "successor" | "admin", User> = {
  owner: {
    id: "usr_lifecycle_owner",
    name: "Original Owner",
    email: "owner@lifecycle.test",
    passwordHash: "hash",
    emailVerifiedAt: 1,
    createdAt: 1_000,
    updatedAt: 1_000,
  },
  successor: {
    id: "usr_lifecycle_successor",
    name: "Successor",
    email: "successor@lifecycle.test",
    passwordHash: "hash",
    emailVerifiedAt: 1,
    createdAt: 1_000,
    updatedAt: 1_000,
  },
  admin: {
    id: "usr_lifecycle_admin",
    name: "Admin",
    email: "admin@lifecycle.test",
    passwordHash: "hash",
    emailVerifiedAt: 1,
    createdAt: 1_000,
    updatedAt: 1_000,
  },
};

const WORKSPACE: Workspace = {
  id: "ws_lifecycle",
  name: "Lifecycle Workspace",
  slug: "lifecycle-workspace",
  timezone: "UTC",
  ownerUserId: USERS.owner.id,
  createdAt: 1_000,
  updatedAt: 1_000,
  deletedAt: null,
};

describe("workspace ownership and deletion routes", () => {
  let app: Hono<AppEnv>;
  let workspaces: D1WorkspaceRepo;
  let members: D1MemberRepo;
  let invitations: D1InvitationRepo;
  let audits: D1AuditRepo;
  let billing: RecordingBillingCanceller;
  let tokens: Record<keyof typeof USERS, string>;

  beforeEach(async () => {
    await freshDb();
    const bindings = testEnv();
    const users = new D1UserRepo(bindings.DB);
    workspaces = new D1WorkspaceRepo(bindings.DB);
    members = new D1MemberRepo(bindings.DB);
    invitations = new D1InvitationRepo(bindings.DB);
    audits = new D1AuditRepo(bindings.DB);
    for (const user of Object.values(USERS)) await users.insert(user);
    await workspaces.insert(WORKSPACE);
    await members.insert({
      id: "mem_lifecycle_owner",
      workspaceId: WORKSPACE.id,
      userId: USERS.owner.id,
      role: "OWNER",
      invitedBy: null,
      joinedAt: 1_000,
    });
    await members.insert({
      id: "mem_lifecycle_successor",
      workspaceId: WORKSPACE.id,
      userId: USERS.successor.id,
      role: "MEMBER",
      invitedBy: USERS.owner.id,
      joinedAt: 1_001,
    });
    await members.insert({
      id: "mem_lifecycle_admin",
      workspaceId: WORKSPACE.id,
      userId: USERS.admin.id,
      role: "ADMIN",
      invitedBy: USERS.owner.id,
      joinedAt: 1_002,
    });
    const config = loadConfig(bindings);
    tokens = {
      owner: `Bearer ${await issueAccessToken(config, USERS.owner, systemClock)}`,
      successor: `Bearer ${await issueAccessToken(config, USERS.successor, systemClock)}`,
      admin: `Bearer ${await issueAccessToken(config, USERS.admin, systemClock)}`,
    };
    billing = new RecordingBillingCanceller();
    app = buildApp(bindings, { billingCanceller: billing });
  });

  function jsonRequest(
    body: object,
    authorization: string,
    method: "POST" | "DELETE" = "POST",
  ): RequestInit {
    return {
      method,
      headers: {
        Authorization: authorization,
        "content-type": "application/json",
        "CF-Connecting-IP": "203.0.113.80",
      },
      body: JSON.stringify(body),
    };
  }

  it("transfers ownership and flips both membership roles atomically", async () => {
    const missingMember = await app.request(
      `/api/workspaces/${WORKSPACE.id}/transfer-ownership`,
      jsonRequest({ newOwnerUserId: "usr_not_a_member" }, tokens.owner),
    );
    expect(missingMember.status).toBe(404);

    const response = await app.request(
      `/api/workspaces/${WORKSPACE.id}/transfer-ownership`,
      jsonRequest(
        { newOwnerUserId: USERS.successor.id },
        tokens.owner,
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { ok: true } });
    await expect(workspaces.findById(WORKSPACE.id)).resolves.toMatchObject({
      ownerUserId: USERS.successor.id,
    });
    await expect(
      members.find(WORKSPACE.id, USERS.owner.id),
    ).resolves.toMatchObject({ role: "ADMIN" });
    await expect(
      members.find(WORKSPACE.id, USERS.successor.id),
    ).resolves.toMatchObject({ role: "OWNER" });
    await expect(audits.list(WORKSPACE.id, null, 10)).resolves.toEqual([
      expect.objectContaining({ action: "workspace.ownership_transferred" }),
    ]);
  });

  it("returns 403 when a non-owner transfers or deletes", async () => {
    const transfer = await app.request(
      `/api/workspaces/${WORKSPACE.id}/transfer-ownership`,
      jsonRequest({ newOwnerUserId: USERS.successor.id }, tokens.admin),
    );
    const deletion = await app.request(
      `/api/workspaces/${WORKSPACE.id}`,
      jsonRequest({ confirmName: WORKSPACE.name }, tokens.admin, "DELETE"),
    );

    expect(transfer.status).toBe(403);
    expect(deletion.status).toBe(403);
  });

  it("requires the exact workspace name before deletion", async () => {
    const response = await app.request(
      `/api/workspaces/${WORKSPACE.id}`,
      jsonRequest({ confirmName: ` ${WORKSPACE.name}` }, tokens.owner, "DELETE"),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request",
        details: [{ field: "confirmName", message: "Name does not match" }],
      },
    });
    await expect(workspaces.findById(WORKSPACE.id)).resolves.not.toBeNull();
  });

  it("audits, soft-deletes, revokes invitations, cancels billing, and disappears", async () => {
    await invitations.insert({
      id: "inv_lifecycle_pending",
      workspaceId: WORKSPACE.id,
      email: "pending@example.com",
      role: "MEMBER",
      tokenHash: "pending-hash",
      invitedBy: USERS.owner.id,
      expiresAt: Date.now() + 10_000,
      acceptedAt: null,
      revokedAt: null,
      createdAt: 1_000,
    });

    const response = await app.request(
      `/api/workspaces/${WORKSPACE.id}`,
      jsonRequest({ confirmName: WORKSPACE.name }, tokens.owner, "DELETE"),
    );

    expect(response.status).toBe(204);
    expect(billing.workspaceIds).toEqual([WORKSPACE.id]);
    await expect(invitations.findPending(WORKSPACE.id)).resolves.toEqual([]);
    await expect(workspaces.findById(WORKSPACE.id)).resolves.toBeNull();
    await expect(workspaces.findById(WORKSPACE.id, true)).resolves.toMatchObject({
      deletedAt: expect.any(Number),
    });
    await expect(audits.list(WORKSPACE.id, null, 10)).resolves.toEqual([
      expect.objectContaining({ action: "workspace.deleted" }),
    ]);

    const getResponse = await app.request(`/api/workspaces/${WORKSPACE.id}`, {
      headers: { Authorization: tokens.owner },
    });
    expect(getResponse.status).toBe(404);
    const listResponse = await app.request("/api/workspaces", {
      headers: { Authorization: tokens.owner },
    });
    await expect(listResponse.json()).resolves.toEqual({ data: [] });
  });

  it("keeps deletion successful when billing cancellation fails", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    billing = new RecordingBillingCanceller(new Error("provider unavailable"));
    app = buildApp(testEnv(), { billingCanceller: billing });

    const response = await app.request(
      `/api/workspaces/${WORKSPACE.id}`,
      jsonRequest({ confirmName: WORKSPACE.name }, tokens.owner, "DELETE"),
    );

    expect(response.status).toBe(204);
    await expect(workspaces.findById(WORKSPACE.id)).resolves.toBeNull();
    expect(log.mock.calls.some(([line]) => String(line).includes("billing_cancel_failed"))).toBe(
      true,
    );
    log.mockRestore();
  });
});
