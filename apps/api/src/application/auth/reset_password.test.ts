import type { EmailToken, RefreshToken } from "../../domain/users/types";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import { sha256Hex, verifyPassword } from "../../shared/crypto";
import { authTestDependencies, testUser } from "../../test/fakes/auth";
import { ResetPassword } from "./reset_password";

describe("ResetPassword", () => {
  it("changes the password, consumes the token, and revokes every session", async () => {
    const dependencies = authTestDependencies();
    const user = testUser();
    const plain = "reset-plain";
    const resetToken: EmailToken = {
      id: "tok_reset",
      userId: user.id,
      type: "RESET_PASSWORD",
      tokenHash: await sha256Hex(plain),
      expiresAt: dependencies.clock.now() + 1_000,
      usedAt: null,
      createdAt: dependencies.clock.now(),
    };
    const refreshToken: RefreshToken = {
      id: "rt_active",
      userId: user.id,
      tokenHash: await sha256Hex("refresh-plain"),
      expiresAt: dependencies.clock.now() + 1_000,
      revokedAt: null,
      replacedById: null,
      createdAt: dependencies.clock.now(),
    };
    await dependencies.users.insert(user);
    await dependencies.workspaces.insert({
      id: "ws_password_reset",
      name: "Password Reset Workspace",
      slug: "password-reset-workspace",
      timezone: "UTC",
      ownerUserId: user.id,
      createdAt: dependencies.clock.now(),
      updatedAt: dependencies.clock.now(),
      deletedAt: null,
    });
    await dependencies.members.insert({
      id: "mem_password_reset",
      workspaceId: "ws_password_reset",
      userId: user.id,
      role: "OWNER",
      invitedBy: null,
      joinedAt: dependencies.clock.now(),
    });
    await dependencies.emailTokens.insert(resetToken);
    await dependencies.refreshTokens.insert(refreshToken);

    await expect(
      new ResetPassword(dependencies).execute({
        token: plain,
        password: "new-password",
        ip: "203.0.113.8",
      }),
    ).resolves.toEqual({ reset: true });

    const updatedUser = await dependencies.users.findById(user.id);
    await expect(
      verifyPassword("new-password", updatedUser?.passwordHash ?? ""),
    ).resolves.toBe(true);
    expect(updatedUser?.updatedAt).toBe(dependencies.clock.now());
    expect(dependencies.emailTokens.tokens.get(resetToken.id)?.usedAt).toBe(
      dependencies.clock.now(),
    );
    expect(
      dependencies.refreshTokens.tokens.get(refreshToken.id)?.revokedAt,
    ).toBe(dependencies.clock.now());
    expect([...dependencies.audits.entries.values()]).toEqual([
      expect.objectContaining({
        workspaceId: "ws_password_reset",
        actorUserId: user.id,
        action: AUDIT_ACTIONS.authPasswordReset,
        resourceType: "user",
        resourceId: user.id,
        ip: "203.0.113.8",
      }),
    ]);
  });

  it.each([
    { label: "expired", expiresAt: 0, usedAt: null },
    { label: "used", expiresAt: Number.MAX_SAFE_INTEGER, usedAt: 1 },
  ])("returns GONE for a $label token", async ({ expiresAt, usedAt }) => {
    const dependencies = authTestDependencies();
    const plain = "invalid-reset";
    await dependencies.emailTokens.insert({
      id: "tok_invalid_reset",
      userId: "usr_alice",
      type: "RESET_PASSWORD",
      tokenHash: await sha256Hex(plain),
      expiresAt,
      usedAt,
      createdAt: 0,
    });

    await expect(
      new ResetPassword(dependencies).execute({
        token: plain,
        password: "new-password",
      }),
    ).rejects.toMatchObject({
      code: "GONE",
      message: "This password reset link is invalid or has expired",
    });
  });
});
