import type { User } from "../../domain/users/types";
import { freshDb, testEnv } from "../../test/helpers";
import { D1PushDeviceRepo } from "./push_device_repo";
import { D1RefreshTokenRepo } from "./refresh_token_repo";
import { D1SessionSecurityRepo } from "./session_security_repo";
import { D1UserRepo } from "./user_repo";

const USER: User = {
  id: "usr_session_security",
  name: "Session Security",
  email: "session-security@example.com",
  passwordHash: "old-hash",
  emailVerifiedAt: 1,
  authVersion: 1,
  createdAt: 1_000,
  updatedAt: 1_000,
};

describe("D1SessionSecurityRepo", () => {
  beforeEach(freshDb);

  it("atomically resets credentials and terminates refresh, admin, and push sessions", async () => {
    const database = testEnv().DB;
    const users = new D1UserRepo(database);
    const refreshTokens = new D1RefreshTokenRepo(database);
    const pushDevices = new D1PushDeviceRepo(database);
    const security = new D1SessionSecurityRepo(database);
    await users.insert(USER);
    await refreshTokens.insert({
      id: "rt_session_security",
      userId: USER.id,
      tokenHash: "session-security-refresh-hash",
      expiresAt: 9_999,
      revokedAt: null,
      replacedById: null,
      createdAt: 1_000,
    });
    await database
      .prepare(
        `INSERT INTO admin_sessions
          (id_hash, user_id, email, auth_version, created_at, expires_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      )
      .bind("admin-session-hash", USER.id, USER.email, 1, 1_000, 9_999)
      .run();
    await pushDevices.insert({
      id: "push_session_security",
      userId: USER.id,
      token: "ExponentPushToken[session-security]",
      platform: "ios",
      deviceName: "Lost phone",
      appVersion: "1.0.0",
      enabled: true,
      disabledReason: null,
      lastSeenAt: 1_000,
      createdAt: 1_000,
      updatedAt: 1_000,
    });

    await security.resetPasswordAndRevokeAll(USER.id, "new-hash", 2_000);

    await expect(users.findById(USER.id)).resolves.toMatchObject({
      passwordHash: "new-hash",
      authVersion: 2,
      updatedAt: 2_000,
    });
    await expect(
      refreshTokens.findByHash("session-security-refresh-hash"),
    ).resolves.toBeNull();
    await expect(
      database
        .prepare("SELECT revoked_at FROM refresh_tokens WHERE id = ?")
        .bind("rt_session_security")
        .first(),
    ).resolves.toEqual({ revoked_at: 2_000 });
    await expect(
      database
        .prepare("SELECT revoked_at FROM admin_sessions WHERE user_id = ?")
        .bind(USER.id)
        .first(),
    ).resolves.toEqual({ revoked_at: 2_000 });
    await expect(pushDevices.findById(USER.id, "push_session_security")).resolves.toMatchObject({
      enabled: false,
      disabledReason: "password_reset",
      updatedAt: 2_000,
    });
  });
});
