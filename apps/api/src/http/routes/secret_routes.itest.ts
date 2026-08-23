import type { Hono } from "hono";
import { buildApp } from "../../app";
import type { Subscription } from "../../domain/billing/types";
import type { WorkspaceSecret } from "../../domain/secrets/types";
import type { User } from "../../domain/users/types";
import type { Role, Workspace } from "../../domain/workspaces/types";
import { issueAccessToken } from "../../infrastructure/auth/jwt";
import { D1AuditRepo } from "../../infrastructure/db/audit_repo";
import { D1MemberRepo } from "../../infrastructure/db/member_repo";
import { D1SecretRepo } from "../../infrastructure/db/secret_repo";
import { D1SubscriptionRepo } from "../../infrastructure/db/subscription_repo";
import { D1UserRepo } from "../../infrastructure/db/user_repo";
import { D1WorkspaceRepo } from "../../infrastructure/db/workspace_repo";
import { systemClock } from "../../shared/clock";
import { loadConfig } from "../../shared/config";
import {
  decryptSecret,
  encryptLegacySecretForMigration,
  type EncryptionKeyring,
} from "../../shared/crypto";
import {
  freshDb,
  insertPreFenceLegacyFixture,
  testEnv,
} from "../../test/helpers";
import type { AppEnv } from "../env";

type Actor = "owner" | "admin" | "member";
const PLAINTEXT = "original-password-that-must-never-leak";
const REPLACEMENT = "replacement-password-that-must-never-leak";
const USERS: Record<Actor, User> = {
  owner: {
    id: "usr_secrets_owner",
    name: "Owner",
    email: "owner@secrets.test",
    passwordHash: "hash",
    emailVerifiedAt: 1,
    authVersion: 1,
    createdAt: 1,
    updatedAt: 1,
  },
  admin: {
    id: "usr_secrets_admin",
    name: "Admin",
    email: "admin@secrets.test",
    passwordHash: "hash",
    emailVerifiedAt: 1,
    authVersion: 1,
    createdAt: 1,
    updatedAt: 1,
  },
  member: {
    id: "usr_secrets_member",
    name: "Member",
    email: "member@secrets.test",
    passwordHash: "hash",
    emailVerifiedAt: 1,
    authVersion: 1,
    createdAt: 1,
    updatedAt: 1,
  },
};
const ROLES: Record<Actor, Role> = {
  owner: "OWNER",
  admin: "ADMIN",
  member: "MEMBER",
};
const WORKSPACE: Workspace = {
  id: "ws_secrets",
  name: "Secrets Workspace",
  slug: "secrets-workspace",
  timezone: "UTC",
  ownerUserId: USERS.owner.id,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};
const SUBSCRIPTION: Subscription = {
  id: "sub_secrets",
  workspaceId: WORKSPACE.id,
  provider: "paddle",
  providerCustomerId: "ctm_secrets",
  providerSubscriptionId: "sub_provider_secrets",
  status: "ACTIVE",
  periodStart: 1,
  periodEnd: 9_999_999_999_999,
  cancelAtPeriodEnd: false,
  updatePaymentUrl: null,
  cancelUrl: null,
  createdAt: 1,
  updatedAt: 1,
};

describe("secret routes", () => {
  let app: Hono<AppEnv>;
  let tokens: Record<Actor, string>;
  let secrets: D1SecretRepo;
  let subscriptions: D1SubscriptionRepo;
  let audits: D1AuditRepo;
  let encryptionKeys: EncryptionKeyring;

  beforeEach(async () => {
    await freshDb();
    const bindings = testEnv();
    const users = new D1UserRepo(bindings.DB);
    const workspaces = new D1WorkspaceRepo(bindings.DB);
    const members = new D1MemberRepo(bindings.DB);
    for (const user of Object.values(USERS)) await users.insert(user);
    await workspaces.insert(WORKSPACE);
    let sequence = 0;
    for (const actor of ["owner", "admin", "member"] as const) {
      sequence += 1;
      await members.insert({
        id: `mem_secrets_${sequence}`,
        workspaceId: WORKSPACE.id,
        userId: USERS[actor].id,
        role: ROLES[actor],
        invitedBy: actor === "owner" ? null : USERS.owner.id,
        joinedAt: sequence,
      });
    }
    subscriptions = new D1SubscriptionRepo(bindings.DB);
    await subscriptions.upsertByWorkspace(SUBSCRIPTION);
    secrets = new D1SecretRepo(bindings.DB);
    audits = new D1AuditRepo(bindings.DB);
    const config = loadConfig(bindings);
    encryptionKeys = config.encryptionKeys;
    tokens = {
      owner: `Bearer ${await issueAccessToken(config, USERS.owner, systemClock)}`,
      admin: `Bearer ${await issueAccessToken(config, USERS.admin, systemClock)}`,
      member: `Bearer ${await issueAccessToken(config, USERS.member, systemClock)}`,
    };
    app = buildApp(bindings);
  });

  function headers(actor: Actor): HeadersInit {
    return {
      Authorization: tokens[actor],
      "content-type": "application/json",
    };
  }

  async function create() {
    const response = await app.request(
      `/api/workspaces/${WORKSPACE.id}/secrets`,
      {
        method: "POST",
        headers: headers("owner"),
        body: JSON.stringify({
          key: "SHOP_PASSWORD",
          value: PLAINTEXT,
          allowedDomains: ["example.com", "*.shop.example.com"],
          description: "Staging login",
        }),
      },
    );
    const text = await response.text();
    expect(response.status).toBe(201);
    expect(text).not.toContain(PLAINTEXT);
    expect(text).not.toContain("encryptedValue");
    return JSON.parse(text) as {
      data: {
        id: string;
        key: string;
        createdBy: { userId: string; name: string };
      };
    };
  }

  it("creates, lists, replaces, and deletes without serializing plaintext", async () => {
    const created = await create();
    expect(created.data).toMatchObject({
      key: "SHOP_PASSWORD",
      createdBy: { userId: USERS.owner.id, name: USERS.owner.name },
    });
    const stored = await secrets.findById(WORKSPACE.id, created.data.id);
    expect(stored?.encryptedValue).not.toBe(PLAINTEXT);
    await expect(
      decryptSecret(stored?.encryptedValue ?? "", encryptionKeys, {
        type: "workspace_secret",
        workspaceId: WORKSPACE.id,
        recordId: created.data.id,
      }),
    ).resolves.toBe(PLAINTEXT);

    const listed = await app.request(
      `/api/workspaces/${WORKSPACE.id}/secrets`,
      { headers: headers("member") },
    );
    const listedText = await listed.text();
    expect(listed.status).toBe(200);
    expect(listedText).not.toContain(PLAINTEXT);
    expect(listedText).not.toContain("encryptedValue");
    expect(JSON.parse(listedText)).toMatchObject({
      data: [{ id: created.data.id, key: "SHOP_PASSWORD" }],
    });

    const replaced = await app.request(
      `/api/workspaces/${WORKSPACE.id}/secrets/${created.data.id}`,
      {
        method: "PUT",
        headers: headers("admin"),
        body: JSON.stringify({
          value: REPLACEMENT,
          allowedDomains: ["new.example.com"],
          description: null,
        }),
      },
    );
    const replacedText = await replaced.text();
    expect(replaced.status).toBe(200);
    expect(replacedText).not.toContain(PLAINTEXT);
    expect(replacedText).not.toContain(REPLACEMENT);
    expect(replacedText).not.toContain("encryptedValue");
    expect(JSON.parse(replacedText)).toMatchObject({
      data: {
        allowedDomains: ["new.example.com"],
        description: null,
      },
    });
    const updated = await secrets.findById(WORKSPACE.id, created.data.id);
    await expect(
      decryptSecret(updated?.encryptedValue ?? "", encryptionKeys, {
        type: "workspace_secret",
        workspaceId: WORKSPACE.id,
        recordId: created.data.id,
      }),
    ).resolves.toBe(REPLACEMENT);

    const deleted = await app.request(
      `/api/workspaces/${WORKSPACE.id}/secrets/${created.data.id}`,
      { method: "DELETE", headers: headers("owner") },
    );
    const deletedText = await deleted.text();
    expect(deleted.status).toBe(204);
    expect(deletedText).not.toContain(PLAINTEXT);
    expect(deletedText).not.toContain(REPLACEMENT);
    await expect(
      secrets.findById(WORKSPACE.id, created.data.id),
    ).resolves.toBeNull();

    const entries = await audits.list(WORKSPACE.id, null, 10);
    expect(entries.map(({ action }) => action)).toEqual([
      "secret.deleted",
      "secret.updated",
      "secret.created",
    ]);
    const auditText = JSON.stringify(entries);
    expect(auditText).not.toContain(PLAINTEXT);
    expect(auditText).not.toContain(REPLACEMENT);
    expect(auditText).toContain("SHOP_PASSWORD");
  });

  it("lets only the owner re-encrypt legacy workspace records in bounded batches", async () => {
    const legacy: WorkspaceSecret = {
      id: "sec_legacy_rotation",
      workspaceId: WORKSPACE.id,
      key: "LEGACY_ROTATION",
      encryptedValue: await encryptLegacySecretForMigration(
        PLAINTEXT,
        encryptionKeys.active.key,
      ),
      encryptionVersion: 1,
      allowedDomains: ["example.com"],
      description: null,
      createdBy: USERS.owner.id,
      createdAt: 1,
      updatedAt: 1,
    };
    await insertPreFenceLegacyFixture(() => secrets.insert(legacy));

    const denied = await app.request(
      `/api/workspaces/${WORKSPACE.id}/security/encryption/rotate`,
      { method: "POST", headers: headers("admin") },
    );
    expect(denied.status).toBe(403);

    const rotated = await app.request(
      `/api/workspaces/${WORKSPACE.id}/security/encryption/rotate?limit=1`,
      { method: "POST", headers: headers("owner") },
    );
    expect(rotated.status).toBe(200);
    await expect(rotated.json()).resolves.toMatchObject({
      data: {
        activeKeyId: encryptionKeys.active.id,
        examined: 1,
        rotated: 1,
        conflicted: 0,
      },
    });
    const stored = await secrets.findById(WORKSPACE.id, legacy.id);
    expect(stored?.encryptionVersion).toBe(4);
    expect(stored?.encryptedValue).toMatch(
      /^v4:dek-[A-Za-z0-9_-]{24}:/u,
    );
    await expect(
      decryptSecret(stored?.encryptedValue ?? "", encryptionKeys, {
        type: "workspace_secret",
        workspaceId: WORKSPACE.id,
        recordId: legacy.id,
      }),
    ).resolves.toBe(PLAINTEXT);
  });

  it("rotates a workspace DEK once and rejects a replayed precondition", async () => {
    const created = await create();
    const statusResponse = await app.request(
      `/api/workspaces/${WORKSPACE.id}/security/encryption/rotate?limit=1`,
      { method: "POST", headers: headers("owner") },
    );
    expect(statusResponse.status).toBe(200);
    const status = JSON.parse(await statusResponse.text()) as {
      data: { activeDataKeyId: string; dataKeyGeneration: number };
    };
    expect(status.data).toMatchObject({ dataKeyGeneration: 1 });

    const rotationResponse = await app.request(
      `/api/workspaces/${WORKSPACE.id}/security/encryption/rotate?limit=1&rotateDataKeyFrom=${encodeURIComponent(status.data.activeDataKeyId)}`,
      { method: "POST", headers: headers("owner") },
    );
    expect(rotationResponse.status).toBe(200);
    const rotation = JSON.parse(await rotationResponse.text()) as {
      data: {
        activeDataKeyId: string;
        dataKeyGeneration: number;
        dataKeyRotated: boolean;
        rotated: number;
      };
    };
    expect(rotation.data).toMatchObject({
      dataKeyGeneration: 2,
      dataKeyRotated: true,
      rotated: 1,
    });
    expect(rotation.data.activeDataKeyId).not.toBe(
      status.data.activeDataKeyId,
    );

    const replay = await app.request(
      `/api/workspaces/${WORKSPACE.id}/security/encryption/rotate?limit=1&rotateDataKeyFrom=${encodeURIComponent(status.data.activeDataKeyId)}`,
      { method: "POST", headers: headers("owner") },
    );
    expect(replay.status).toBe(409);
    const stored = await secrets.findById(WORKSPACE.id, created.data.id);
    await expect(
      decryptSecret(stored?.encryptedValue ?? "", encryptionKeys, {
        type: "workspace_secret",
        workspaceId: WORKSPACE.id,
        recordId: created.data.id,
      }),
    ).resolves.toBe(PLAINTEXT);
  });

  it("lets members read metadata but forbids every mutation", async () => {
    const created = await create();
    const attempts = [
      app.request(`/api/workspaces/${WORKSPACE.id}/secrets`, {
        method: "POST",
        headers: headers("member"),
        body: JSON.stringify({
          key: "OTHER_SECRET",
          value: PLAINTEXT,
          allowedDomains: ["example.com"],
        }),
      }),
      app.request(
        `/api/workspaces/${WORKSPACE.id}/secrets/${created.data.id}`,
        {
          method: "PUT",
          headers: headers("member"),
          body: JSON.stringify({ value: PLAINTEXT }),
        },
      ),
      app.request(
        `/api/workspaces/${WORKSPACE.id}/secrets/${created.data.id}`,
        { method: "DELETE", headers: headers("member") },
      ),
    ];

    for (const response of await Promise.all(attempts)) {
      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain(PLAINTEXT);
    }
    const list = await app.request(`/api/workspaces/${WORKSPACE.id}/secrets`, {
      headers: headers("member"),
    });
    expect(list.status).toBe(200);
  });

  it("returns validation/conflict errors and enforces the active subscription", async () => {
    const badKey = await app.request(
      `/api/workspaces/${WORKSPACE.id}/secrets`,
      {
        method: "POST",
        headers: headers("owner"),
        body: JSON.stringify({
          key: "bad-key",
          value: PLAINTEXT,
          allowedDomains: ["example.com"],
        }),
      },
    );
    expect(badKey.status).toBe(400);
    await expect(badKey.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_ERROR", details: [{ field: "key" }] },
    });

    await create();
    const duplicate = await app.request(
      `/api/workspaces/${WORKSPACE.id}/secrets`,
      {
        method: "POST",
        headers: headers("owner"),
        body: JSON.stringify({
          key: "SHOP_PASSWORD",
          value: REPLACEMENT,
          allowedDomains: ["example.com"],
        }),
      },
    );
    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toMatchObject({
      error: {
        code: "CONFLICT",
        message: "A secret with this key already exists",
      },
    });

    await subscriptions.upsertByWorkspace({
      ...SUBSCRIPTION,
      status: "CANCELED",
      updatedAt: 2,
    });
    const blocked = await app.request(
      `/api/workspaces/${WORKSPACE.id}/secrets`,
      {
        method: "POST",
        headers: headers("owner"),
        body: JSON.stringify({
          key: "BLOCKED_SECRET",
          value: PLAINTEXT,
          allowedDomains: ["example.com"],
        }),
      },
    );
    expect(blocked.status).toBe(402);
    expect(await blocked.text()).not.toContain(PLAINTEXT);

    const stillReadable = await app.request(
      `/api/workspaces/${WORKSPACE.id}/secrets`,
      { headers: headers("member") },
    );
    expect(stillReadable.status).toBe(200);
    expect(await stillReadable.text()).not.toContain(PLAINTEXT);
  });
});
