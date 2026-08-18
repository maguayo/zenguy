import type { EmailToken } from "../../domain/users/types";
import { sha256Hex } from "../../shared/crypto";
import { authTestDependencies, testUser } from "../../test/fakes/auth";
import { VerifyEmail } from "./verify_email";

describe("VerifyEmail", () => {
  it("verifies the user and consumes the token", async () => {
    const dependencies = authTestDependencies();
    const user = testUser();
    const tokenPlain = "plain-verification-token";
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

    await expect(
      new VerifyEmail(dependencies).execute({ token: tokenPlain }),
    ).resolves.toEqual({ verified: true });
    await expect(dependencies.users.findById(user.id)).resolves.toMatchObject({
      emailVerifiedAt: dependencies.clock.now(),
    });
    expect(dependencies.emailTokens.tokens.get(token.id)?.usedAt).toBe(
      dependencies.clock.now(),
    );
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
  });
});
