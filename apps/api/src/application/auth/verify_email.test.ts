import type { EmailToken } from "../../domain/users/types";
import { verifyAccessToken } from "../../infrastructure/auth/jwt";
import { REFRESH_TOKEN_TTL_DAYS } from "../../shared/constants";
import { hashPassword, sha256Hex } from "../../shared/crypto";
import { FakeTrackEvent } from "../../test/fakes/activity";
import { authTestDependencies, testUser } from "../../test/fakes/auth";
import { VerifyEmail } from "./verify_email";

const ORIGINAL_PASSWORD = "correct horse battery staple";

async function seedPendingVerification(
  dependencies: ReturnType<typeof authTestDependencies>,
  tokenPlain: string,
) {
  const user = testUser({ passwordHash: await hashPassword(ORIGINAL_PASSWORD) });
  const token: EmailToken = {
    id: "tok_verify",
    userId: user.id,
    type: "VERIFY_EMAIL",
    tokenHash: await sha256Hex(tokenPlain),
    expiresAt: dependencies.clock.now() + 1,
    usedAt: null,
    createdAt: dependencies.clock.now(),
  };
  await dependencies.users.insert(user);
  await dependencies.emailTokens.insert(token);
  return { user, token };
}

describe("VerifyEmail", () => {
  it("verifies the user and consumes the token", async () => {
    const dependencies = authTestDependencies();
    const tokenPlain = "plain-verification-token";
    const { user, token } = await seedPendingVerification(dependencies, tokenPlain);

    const result = await new VerifyEmail(dependencies).execute({
      token: tokenPlain,
      password: ORIGINAL_PASSWORD,
      client: "web",
    });

    expect(result.user).toMatchObject({
      id: user.id,
      emailVerifiedAt: dependencies.clock.now(),
      authVersion: 1,
    });
    await expect(dependencies.users.findById(user.id)).resolves.toMatchObject({
      emailVerifiedAt: dependencies.clock.now(),
      authVersion: 1,
    });
    expect(dependencies.emailTokens.tokens.get(token.id)?.usedAt).toBe(
      dependencies.clock.now(),
    );
  });

  it("signs the verified user in with a fresh session", async () => {
    const dependencies = authTestDependencies();
    const tokenPlain = "plain-verification-token";
    const { user } = await seedPendingVerification(dependencies, tokenPlain);

    const result = await new VerifyEmail(dependencies).execute({
      token: tokenPlain,
      password: ORIGINAL_PASSWORD,
      client: "web",
    });

    expect(result.expiresIn).toBe(1_800);
    await expect(
      verifyAccessToken(dependencies.config, result.accessToken),
    ).resolves.toMatchObject({ sub: user.id, email: user.email });
    const stored = await dependencies.refreshTokens.findByHash(
      await sha256Hex(result.refreshTokenPlain),
    );
    expect(stored).toMatchObject({
      userId: user.id,
      expiresAt:
        dependencies.clock.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1_000,
      revokedAt: null,
    });
  });

  it.each([
    { label: "expired", expiresAt: 0, usedAt: null },
    { label: "used", expiresAt: Number.MAX_SAFE_INTEGER, usedAt: 1 },
  ])("returns GONE for a $label token", async ({ expiresAt, usedAt }) => {
    const dependencies = authTestDependencies();
    const tokenPlain = "bad-verification-token";
    await dependencies.emailTokens.insert({
      id: "tok_invalid",
      userId: "usr_alice",
      type: "VERIFY_EMAIL",
      tokenHash: await sha256Hex(tokenPlain),
      expiresAt,
      usedAt,
      createdAt: 0,
    });

    await expect(
      new VerifyEmail(dependencies).execute({
        token: tokenPlain,
        password: ORIGINAL_PASSWORD,
        client: "web",
      }),
    ).rejects.toMatchObject({
      code: "GONE",
      message: "This verification link is invalid or has expired",
    });
    expect(dependencies.refreshTokens.tokens.size).toBe(0);
  });

  it("rejects the wrong password without consuming a live token", async () => {
    const dependencies = authTestDependencies();
    const tokenPlain = "live-verification-token";
    const { user, token } = await seedPendingVerification(
      dependencies,
      tokenPlain,
    );

    await expect(
      new VerifyEmail(dependencies).execute({
        token: tokenPlain,
        password: "wrong horse battery staple",
        client: "web",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
      message: "Incorrect password",
    });

    expect(dependencies.emailTokens.tokens.get(token.id)?.usedAt).toBeNull();
    await expect(dependencies.users.findById(user.id)).resolves.toMatchObject({
      emailVerifiedAt: null,
    });
    expect(dependencies.refreshTokens.tokens.size).toBe(0);
  });

  it("does not run the password KDF for an unknown token", async () => {
    const dependencies = authTestDependencies();
    const passwordVerifier = vi.fn(async () => true);

    await expect(
      new VerifyEmail(dependencies, passwordVerifier).execute({
        token: "unknown",
        password: ORIGINAL_PASSWORD,
        client: "web",
      }),
    ).rejects.toMatchObject({ code: "GONE" });

    expect(passwordVerifier).not.toHaveBeenCalled();
  });

  it("allows only one concurrent consumption of the same verification link", async () => {
    const dependencies = authTestDependencies();
    const tokenPlain = "racing-verification-token";
    await seedPendingVerification(dependencies, tokenPlain);
    const useCase = new VerifyEmail(dependencies);

    const results = await Promise.allSettled([
      useCase.execute({
        token: tokenPlain,
        password: ORIGINAL_PASSWORD,
        client: "web",
      }),
      useCase.execute({
        token: tokenPlain,
        password: ORIGINAL_PASSWORD,
        client: "web",
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(
      results.find((result) => result.status === "rejected"),
    ).toMatchObject({ reason: { code: "GONE" } });
    expect(dependencies.refreshTokens.tokens.size).toBe(1);
  });

  it("does not mint a session when a password reset wins before token consumption", async () => {
    const dependencies = authTestDependencies();
    const tokenPlain = "reset-race-verification-token";
    const { user } = await seedPendingVerification(dependencies, tokenPlain);
    const replacementHash = await hashPassword("replacement horse battery");
    const consume = dependencies.emailTokens.consumeValidByHash.bind(
      dependencies.emailTokens,
    );
    vi.spyOn(
      dependencies.emailTokens,
      "consumeValidByHash",
    ).mockImplementationOnce(async (hash, type, at) => {
      await dependencies.sessionSecurity.resetPasswordAndRevokeAll(
        user.id,
        replacementHash,
        at,
      );
      return consume(hash, type, at);
    });

    await expect(
      new VerifyEmail(dependencies).execute({
        token: tokenPlain,
        password: ORIGINAL_PASSWORD,
        client: "web",
      }),
    ).rejects.toMatchObject({ code: "GONE" });

    await expect(dependencies.users.findById(user.id)).resolves.toMatchObject({
      emailVerifiedAt: dependencies.clock.now(),
      passwordHash: replacementHash,
      authVersion: user.authVersion + 1,
    });
    expect(dependencies.refreshTokens.tokens.size).toBe(0);
  });

  it("revokes a session inserted concurrently with a password reset", async () => {
    const dependencies = authTestDependencies();
    const tokenPlain = "session-reset-race-token";
    const { user } = await seedPendingVerification(dependencies, tokenPlain);
    const replacementHash = await hashPassword("replacement horse battery");
    const insert = dependencies.refreshTokens.insert.bind(
      dependencies.refreshTokens,
    );
    vi.spyOn(dependencies.refreshTokens, "insert").mockImplementationOnce(
      async (token) => {
        await insert(token);
        await dependencies.sessionSecurity.resetPasswordAndRevokeAll(
          user.id,
          replacementHash,
          dependencies.clock.now(),
        );
      },
    );

    await expect(
      new VerifyEmail(dependencies).execute({
        token: tokenPlain,
        password: ORIGINAL_PASSWORD,
        client: "web",
      }),
    ).rejects.toMatchObject({ code: "GONE" });

    expect([...dependencies.refreshTokens.tokens.values()]).toEqual([
      expect.objectContaining({
        userId: user.id,
        revokedAt: dependencies.clock.now(),
      }),
    ]);
  });

  it("records user.email_verified with the client as source", async () => {
    const track = new FakeTrackEvent();
    const dependencies = { ...authTestDependencies(), track };
    const tokenPlain = "plain-verification-token";
    const { user } = await seedPendingVerification(dependencies, tokenPlain);

    await new VerifyEmail(dependencies).execute({
      token: tokenPlain,
      password: ORIGINAL_PASSWORD,
      client: "web",
    });

    expect(track.calls).toEqual([
      { type: "user.email_verified", userId: user.id, source: "web" },
    ]);
  });

  it("records nothing for an invalid token", async () => {
    const track = new FakeTrackEvent();
    const verifyEmail = new VerifyEmail({ ...authTestDependencies(), track });

    await expect(
      verifyEmail.execute({
        token: "unknown",
        password: ORIGINAL_PASSWORD,
        client: "web",
      }),
    ).rejects.toMatchObject({ code: "GONE" });
    expect(track.calls).toEqual([]);
  });
});
