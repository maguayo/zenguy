import { env } from "cloudflare:test";
import { D1AdminSessionStore } from "./admin_sessions";
import { newSessionToken, sessionTokenHash } from "./session";

const NOW = 1_700_000_000_000;
const USER_ID = "usr_00000000000000000000000001";
const EMAIL = "admin-session-itest@example.com";
const ACCESS_SUBJECT = "access-admin-session-itest";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM admin_sessions WHERE user_id = ?").bind(USER_ID).run();
  await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(USER_ID).run();
  await env.DB.prepare(
    `INSERT INTO users
       (id, name, email, password_hash, email_verified_at, auth_version, created_at, updated_at)
     VALUES (?, 'Admin', ?, 'irrelevant', ?, 1, ?, ?)`,
  )
    .bind(USER_ID, EMAIL, NOW, NOW, NOW)
    .run();
});

describe("D1AdminSessionStore", () => {
  it("stores only an opaque-token digest and resolves the verified identity", async () => {
    const store = new D1AdminSessionStore(env.DB);
    const token = newSessionToken();
    const idHash = await sessionTokenHash(token, ACCESS_SUBJECT);
    const identity = await store.findEligibleIdentity(USER_ID, EMAIL.toUpperCase());
    expect(identity).toEqual({ userId: USER_ID, email: EMAIL, authVersion: 1 });

    await store.create({
      ...identity!,
      idHash,
      createdAt: NOW,
      expiresAt: NOW + 60_000,
    });

    const row = await env.DB.prepare(
      "SELECT id_hash, email FROM admin_sessions WHERE user_id = ?",
    )
      .bind(USER_ID)
      .first<{ id_hash: string; email: string }>();
    expect(row?.id_hash).toBe(idHash);
    expect(JSON.stringify(row)).not.toContain(token);
    await expect(store.findActive(idHash, NOW)).resolves.toEqual(identity);
  });

  it("fails closed after expiry, explicit revocation, auth-version change or lost verification", async () => {
    const store = new D1AdminSessionStore(env.DB);
    const identity = (await store.findEligibleIdentity(USER_ID, EMAIL))!;

    const expiredHash = await sessionTokenHash(newSessionToken(), ACCESS_SUBJECT);
    await store.create({ ...identity, idHash: expiredHash, createdAt: NOW, expiresAt: NOW + 1 });
    await expect(store.findActive(expiredHash, NOW + 1)).resolves.toBeNull();

    const revokedHash = await sessionTokenHash(newSessionToken(), ACCESS_SUBJECT);
    await store.create({ ...identity, idHash: revokedHash, createdAt: NOW, expiresAt: NOW + 60_000 });
    await store.revoke(revokedHash, NOW + 1);
    await expect(store.findActive(revokedHash, NOW + 2)).resolves.toBeNull();

    const versionHash = await sessionTokenHash(newSessionToken(), ACCESS_SUBJECT);
    await store.create({ ...identity, idHash: versionHash, createdAt: NOW, expiresAt: NOW + 60_000 });
    await env.DB.prepare("UPDATE users SET auth_version = auth_version + 1 WHERE id = ?")
      .bind(USER_ID)
      .run();
    await expect(store.findActive(versionHash, NOW + 2)).resolves.toBeNull();

    await env.DB.prepare("UPDATE users SET email_verified_at = NULL WHERE id = ?").bind(USER_ID).run();
    await expect(store.findEligibleIdentity(USER_ID, EMAIL)).resolves.toBeNull();
  });
});
