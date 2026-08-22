import type { EmailToken } from "../../domain/users/types";
import { verifyAccessToken } from "../../infrastructure/auth/jwt";
import { REFRESH_TOKEN_TTL_DAYS } from "../../shared/constants";
import { sha256Hex } from "../../shared/crypto";
import { authTestDependencies, testUser } from "../../test/fakes/auth";
import { VerifyEmail } from "./verify_email";

async function seedPendingVerification(
  dependencies: ReturnType<typeof authTestDependencies>,
  tokenPlain: string,
) {
  const user = testUser();
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
    });

    expect(result.user).toMatchObject({
      id: user.id,
      emailVerifiedAt: dependencies.clock.now(),
    });
    await expect(dependencies.users.findById(user.id)).resolves.toMatchObject({
      emailVerifiedAt: dependencies.clock.now(),
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
      new VerifyEmail(dependencies).execute({ token: tokenPlain }),
    ).rejects.toMatchObject({
      code: "GONE",
      message: "This verification link is invalid or has expired",
    });
    expect(dependencies.refreshTokens.tokens.size).toBe(0);
  });
});
