import type { Hono } from "hono";
import { buildApp } from "../../app";
import type { User } from "../../domain/users/types";
import type { Workspace } from "../../domain/workspaces/types";
import { issueAccessToken } from "../../infrastructure/auth/jwt";
import { D1InvitationRepo } from "../../infrastructure/db/invitation_repo";
import { D1MemberRepo } from "../../infrastructure/db/member_repo";
import { D1UserRepo } from "../../infrastructure/db/user_repo";
import { D1WorkspaceRepo } from "../../infrastructure/db/workspace_repo";
import { systemClock } from "../../shared/clock";
import { loadConfig } from "../../shared/config";
import { RATE_LIMITS } from "../../shared/constants";
import { sha256Hex } from "../../shared/crypto";
import { RecordingEmailSender } from "../../test/fakes/email";
import { freshDb, freshKv, testEnv } from "../../test/helpers";
import type { AppEnv } from "../env";

const USERS: Record<"owner" | "admin" | "invitee" | "wrong", User> = {
  owner: {
    id: "usr_invite_owner",
    name: "Owner Alice",
    email: "owner@invite.test",
    passwordHash: "hash",
    emailVerifiedAt: 1,
    authVersion: 1,
    createdAt: 1_000,
    updatedAt: 1_000,
  },
  admin: {
    id: "usr_invite_admin",
    name: "Admin Alex",
    email: "admin@invite.test",
    passwordHash: "hash",
    emailVerifiedAt: 1,
    authVersion: 1,
    createdAt: 1_000,
    updatedAt: 1_000,
  },
  invitee: {
    id: "usr_invitee",
    name: "Invited Ivy",
    email: "invitee@example.com",
    passwordHash: "hash",
    emailVerifiedAt: 1,
    authVersion: 1,
    createdAt: 1_000,
    updatedAt: 1_000,
  },
  wrong: {
    id: "usr_wrong_invitee",
    name: "Wrong Wendy",
    email: "wrong@example.com",
    passwordHash: "hash",
    emailVerifiedAt: 1,
    authVersion: 1,
    createdAt: 1_000,
    updatedAt: 1_000,
  },
};

const WORKSPACE: Workspace = {
  id: "ws_invitations",
  name: "Acme Workspace",
  slug: "acme-workspace",
  timezone: "UTC",
  ownerUserId: USERS.owner.id,
  createdAt: 1_000,
  updatedAt: 1_000,
  deletedAt: null,
};

function jsonRequest(body: object, authorization?: string): RequestInit {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorization === undefined
        ? {}
        : { Authorization: authorization }),
      "CF-Connecting-IP": "203.0.113.70",
    },
    body: JSON.stringify(body),
  };
}

function invitationToken(message: string | undefined): string {
  const rawUrl = message?.match(/https?:\/\/\S+/u)?.[0];
  if (rawUrl === undefined) throw new Error("Invitation email has no URL");
  const fragment = new URL(rawUrl).hash.slice(1);
  if (fragment === "") {
    throw new Error("Invitation URL has no token");
  }
  return decodeURIComponent(fragment);
}

describe("invitation routes", () => {
  let app: Hono<AppEnv>;
  let members: D1MemberRepo;
  let invitations: D1InvitationRepo;
  let emails: RecordingEmailSender;
  let tokens: Record<keyof typeof USERS, string>;

  beforeEach(async () => {
    await freshDb();
    await freshKv();
    const bindings = testEnv();
    const users = new D1UserRepo(bindings.DB);
    const workspaces = new D1WorkspaceRepo(bindings.DB);
    members = new D1MemberRepo(bindings.DB);
    invitations = new D1InvitationRepo(bindings.DB);
    for (const user of Object.values(USERS)) await users.insert(user);
    await workspaces.insert(WORKSPACE);
    await members.insert({
      id: "mem_invite_owner",
      workspaceId: WORKSPACE.id,
      userId: USERS.owner.id,
      role: "OWNER",
      invitedBy: null,
      joinedAt: 1_000,
    });
    await members.insert({
      id: "mem_invite_admin",
      workspaceId: WORKSPACE.id,
      userId: USERS.admin.id,
      role: "ADMIN",
      invitedBy: USERS.owner.id,
      joinedAt: 1_000,
    });
    const config = loadConfig(bindings);
    tokens = {
      owner: `Bearer ${await issueAccessToken(config, USERS.owner, systemClock)}`,
      admin: `Bearer ${await issueAccessToken(config, USERS.admin, systemClock)}`,
      invitee: `Bearer ${await issueAccessToken(config, USERS.invitee, systemClock)}`,
      wrong: `Bearer ${await issueAccessToken(config, USERS.wrong, systemClock)}`,
    };
    emails = new RecordingEmailSender();
    app = buildApp(bindings, { emailSender: emails });
  });

  async function invite(
    authorization: string,
    email: string,
    role: "ADMIN" | "MEMBER",
  ): Promise<Response> {
    return app.request(
      `/api/workspaces/${WORKSPACE.id}/invitations`,
      jsonRequest({ email, role }, authorization),
    );
  }

  it("lets admins invite members, but only owners invite admins", async () => {
    const memberInvite = await invite(
      tokens.admin,
      "new-member@example.com",
      "MEMBER",
    );
    expect(memberInvite.status).toBe(201);
    const memberBody = (await memberInvite.json()) as {
      data: Record<string, unknown>;
    };
    expect(memberBody.data).toMatchObject({
      email: "new-member@example.com",
      role: "MEMBER",
      invitedBy: { userId: USERS.admin.id, name: USERS.admin.name },
    });
    expect(memberBody.data).not.toHaveProperty("tokenHash");
    expect(emails.messages[0]?.subject).toBe(
      "You've been invited to Acme Workspace on Zenguy",
    );

    const forbiddenAdminInvite = await invite(
      tokens.admin,
      "new-admin@example.com",
      "ADMIN",
    );
    expect(forbiddenAdminInvite.status).toBe(403);
    await expect(forbiddenAdminInvite.json()).resolves.toEqual({
      error: {
        code: "FORBIDDEN",
        message: "Only the owner can invite admins",
      },
    });

    const ownerAdminInvite = await invite(
      tokens.owner,
      "new-admin@example.com",
      "ADMIN",
    );
    expect(ownerAdminInvite.status).toBe(201);

    const existingMember = await invite(
      tokens.owner,
      USERS.admin.email,
      "MEMBER",
    );
    expect(existingMember.status).toBe(409);
    await expect(existingMember.json()).resolves.toMatchObject({
      error: { code: "CONFLICT", message: "Already a member" },
    });
  });

  it("rejects wrong-email acceptance and expired invitations", async () => {
    const response = await invite(
      tokens.owner,
      USERS.invitee.email,
      "MEMBER",
    );
    expect(response.status).toBe(201);
    const token = invitationToken(emails.messages.at(-1)?.text);

    const publicResponse = await app.request(
      "/api/invitations/preview",
      jsonRequest({ token }),
    );
    expect(publicResponse.status).toBe(200);
    await expect(publicResponse.json()).resolves.toMatchObject({
      data: {
        workspaceName: WORKSPACE.name,
        inviterName: USERS.owner.name,
        email: USERS.invitee.email,
        role: "MEMBER",
      },
    });

    const wrongAccept = await app.request(
      "/api/invitations/accept",
      jsonRequest({ token }, tokens.wrong),
    );
    expect(wrongAccept.status).toBe(403);
    await expect(wrongAccept.json()).resolves.toMatchObject({
      error: {
        code: "FORBIDDEN",
        message: "This invitation was sent to a different email address",
      },
    });

    const expiredPlain = "expired-invitation-token";
    await invitations.insert({
      id: "inv_expired",
      workspaceId: WORKSPACE.id,
      email: USERS.invitee.email,
      role: "MEMBER",
      tokenHash: await sha256Hex(expiredPlain),
      invitedBy: USERS.owner.id,
      expiresAt: Date.now() - 1,
      acceptedAt: null,
      revokedAt: null,
      createdAt: 1_000,
    });
    const expired = await app.request(
      "/api/invitations/preview",
      jsonRequest({ token: expiredPlain }),
    );
    expect(expired.status).toBe(410);
  });

  it("accepts idempotently while consumed public links return 410", async () => {
    await invite(tokens.owner, USERS.invitee.email, "MEMBER");
    const token = invitationToken(emails.messages.at(-1)?.text);

    const first = await app.request(
      "/api/invitations/accept",
      jsonRequest({ token }, tokens.invitee),
    );
    const second = await app.request(
      "/api/invitations/accept",
      jsonRequest({ token }, tokens.invitee),
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toEqual({
      data: { workspaceId: WORKSPACE.id },
    });
    await expect(
      members.find(WORKSPACE.id, USERS.invitee.id),
    ).resolves.toMatchObject({ role: "MEMBER" });

    const consumedPublic = await app.request(
      "/api/invitations/preview",
      jsonRequest({ token }),
    );
    expect(consumedPublic.status).toBe(410);
  });

  it("rejects a planted invite after its issuer loses authority", async () => {
    await invite(tokens.owner, USERS.invitee.email, "ADMIN");
    const token = invitationToken(emails.messages.at(-1)?.text);
    await members.updateRole(WORKSPACE.id, USERS.owner.id, "ADMIN");

    const response = await app.request(
      "/api/invitations/accept",
      jsonRequest({ token }, tokens.invitee),
    );

    expect(response.status).toBe(410);
    await expect(
      members.find(WORKSPACE.id, USERS.invitee.id),
    ).resolves.toBeNull();
  });

  it("re-inviting revokes the old token and list/delete expose pending only", async () => {
    await invite(tokens.owner, "pending@example.com", "MEMBER");
    const firstPlain = invitationToken(emails.messages.at(-1)?.text);
    const firstStored = await invitations.findByHash(await sha256Hex(firstPlain));
    await invite(tokens.owner, "PENDING@example.com", "ADMIN");
    const secondPlain = invitationToken(emails.messages.at(-1)?.text);

    await expect(
      invitations.findByHash(await sha256Hex(firstPlain)),
    ).resolves.toMatchObject({ revokedAt: expect.any(Number) });
    await expect(
      invitations.findByHash(await sha256Hex(secondPlain)),
    ).resolves.toMatchObject({ revokedAt: null, role: "ADMIN" });

    const listResponse = await app.request(
      `/api/workspaces/${WORKSPACE.id}/invitations`,
      { headers: { Authorization: tokens.owner } },
    );
    const list = (await listResponse.json()) as {
      data: { id: string; email: string; role: string }[];
    };
    expect(list.data).toHaveLength(1);
    expect(list.data[0]).toMatchObject({
      email: "pending@example.com",
      role: "ADMIN",
    });
    expect(list.data[0]?.id).not.toBe(firstStored?.id);

    const deleteResponse = await app.request(
      `/api/workspaces/${WORKSPACE.id}/invitations/${list.data[0]?.id ?? "missing"}`,
      { method: "DELETE", headers: { Authorization: tokens.owner } },
    );
    expect(deleteResponse.status).toBe(204);
    await expect(invitations.findPending(WORKSPACE.id)).resolves.toEqual([]);
  });

  it("limits invitation creation to 20 per workspace per day", async () => {
    for (
      let attempt = 0;
      attempt < RATE_LIMITS.invitations.limit;
      attempt += 1
    ) {
      const response = await invite(
        tokens.owner,
        `invite-${attempt}@example.com`,
        "MEMBER",
      );
      expect(response.status).toBe(201);
    }

    const limited = await invite(
      tokens.owner,
      "one-too-many@example.com",
      "MEMBER",
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toMatch(/^\d+$/u);
  });
});
