import { verifyAccessToken } from "../../infrastructure/auth/jwt";
import { REFRESH_TOKEN_TTL_DAYS } from "../../shared/constants";
import { hashPassword, sha256Hex } from "../../shared/crypto";
import { authTestDependencies, testUser } from "../../test/fakes/auth";
import { Login } from "./login";

describe("Login", () => {
  it("creates a session for correct credentials, including unverified users", async () => {
    const dependencies = authTestDependencies();
    const user = testUser({
      passwordHash: await hashPassword("correct-password"),
      emailVerifiedAt: null,
    });
    await dependencies.users.insert(user);

    const result = await new Login(dependencies).execute({
      email: " ALICE@EXAMPLE.COM ",
      password: "correct-password",
    });

    expect(result.user).toEqual(user);
    expect(result.expiresIn).toBe(1_800);
    await expect(
      verifyAccessToken(dependencies.config, result.accessToken),
    ).resolves.toMatchObject({ sub: user.id });
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
    { email: "alice@example.com", password: "wrong-password" },
    { email: "unknown@example.com", password: "correct-password" },
  ])("returns the same error for invalid credentials", async (input) => {
    const dependencies = authTestDependencies();
    await dependencies.users.insert(
      testUser({ passwordHash: await hashPassword("correct-password") }),
    );

    await expect(new Login(dependencies).execute(input)).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
      message: "Incorrect email or password",
    });
  });
});
