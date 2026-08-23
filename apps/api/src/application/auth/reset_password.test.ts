import type { EmailToken, RefreshToken } from "../../domain/users/types";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import { sha256Hex, verifyPassword } from "../../shared/crypto";
import { authTestDependencies, testUser } from "../../test/fakes/auth";
import { ResetPassword } from "./reset_password";

describe("ResetPassword", () => {
  it.each(["too-short", "passwordpassword"])(
    "enforces the new-password policy before token lookup for %s",
    async (password) => {
      const dependencies = authTestDependencies();
      const passwordHasher = vi.fn(async () => "must-not-be-created");
      const tokenLookup = vi.spyOn(
        dependencies.emailTokens,
        "findValidByHash",
      );

      await expect(
        new ResetPassword(dependencies, passwordHasher).execute({
          token: "any-token",
          password,
        }),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        details: [expect.objectContaining({ field: "password" })],
      });
      expect(tokenLookup).not.toHaveBeenCalled();
      expect(passwordHasher).not.toHaveBeenCalled();
    },
  );

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
        password: "new-strong-password",
        ip: "203.0.113.8",
      }),
    ).resolves.toEqual({ reset: true });

    const updatedUser = await dependencies.users.findById(user.id);
    await expect(
      verifyPassword("new-strong-password", updatedUser?.passwordHash ?? ""),
    ).resolves.toBe(true);
    expect(updatedUser?.updatedAt).toBe(dependencies.clock.now());
    expect(updatedUser?.authVersion).toBe(user.authVersion + 1);
    expect(dependencies.emailTokens.tokens.get(resetToken.id)?.usedAt).toBe(
      dependencies.clock.now(),
    );
    expect(
      dependencies.refreshTokens.tokens.get(refreshToken.id)?.revokedAt,
    ).toBe(dependencies.clock.now());
    expect(dependencies.sessionSecurity.revokedAdminUsers).toContain(user.id);
    expect(dependencies.sessionSecurity.disabledPushUsers).toContain(user.id);
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
    const passwordHasher = vi.fn(async () => "unreachable-password-hash");
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
      new ResetPassword(dependencies, passwordHasher).execute({
        token: plain,
        password: "new-strong-password",
      }),
    ).rejects.toMatchObject({
      code: "GONE",
      message: "This password reset link is invalid or has expired",
    });
    expect(passwordHasher).not.toHaveBeenCalled();
  });

  it("does not consume a live token when password hashing fails", async () => {
    const dependencies = authTestDependencies();
    const plain = "live-reset";
    const token: EmailToken = {
      id: "tok_live_reset",
      userId: "usr_alice",
      type: "RESET_PASSWORD",
      tokenHash: await sha256Hex(plain),
      expiresAt: dependencies.clock.now() + 1_000,
      usedAt: null,
      createdAt: dependencies.clock.now(),
    };
    await dependencies.emailTokens.insert(token);
    const hashingFailure = new Error("password hashing failed");

    await expect(
      new ResetPassword(dependencies, async () => {
        throw hashingFailure;
      }).execute({ token: plain, password: "new-strong-password" }),
    ).rejects.toBe(hashingFailure);

    expect(dependencies.emailTokens.tokens.get(token.id)?.usedAt).toBeNull();
  });

  it("keeps token claiming atomic after concurrent valid preflights", async () => {
    const dependencies = authTestDependencies();
    const user = testUser();
    const plain = "concurrent-live-reset";
    const token: EmailToken = {
      id: "tok_concurrent_live_reset",
      userId: user.id,
      type: "RESET_PASSWORD",
      tokenHash: await sha256Hex(plain),
      expiresAt: dependencies.clock.now() + 1_000,
      usedAt: null,
      createdAt: dependencies.clock.now(),
    };
    await dependencies.users.insert(user);
    await dependencies.emailTokens.insert(token);

    let releaseHashing!: () => void;
    const hashingGate = new Promise<void>((resolve) => {
      releaseHashing = resolve;
    });
    let signalBothHashing!: () => void;
    const bothHashing = new Promise<void>((resolve) => {
      signalBothHashing = resolve;
    });
    let hashingCalls = 0;
    const passwordHasher = vi.fn(async () => {
      hashingCalls += 1;
      if (hashingCalls === 2) signalBothHashing();
      await hashingGate;
      return "replacement-password-hash";
    });
    const reset = new ResetPassword(dependencies, passwordHasher);

    const attempts = [
      reset.execute({ token: plain, password: "new-strong-password" }),
      reset.execute({ token: plain, password: "new-strong-password" }),
    ];
    await bothHashing;
    releaseHashing();
    const outcomes = await Promise.allSettled(attempts);

    expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    expect(outcomes.filter(({ status }) => status === "rejected")).toEqual([
      expect.objectContaining({
        reason: expect.objectContaining({ code: "GONE" }),
      }),
    ]);
    expect(dependencies.emailTokens.tokens.get(token.id)?.usedAt).toBe(
      dependencies.clock.now(),
    );
    expect(dependencies.sessionSecurity.revocations).toHaveLength(1);
  });
});
