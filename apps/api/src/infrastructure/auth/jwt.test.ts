import type { User } from "../../domain/users/types";
import { FixedClock } from "../../shared/clock";
import type { AppConfig } from "../../shared/config";
import { ACCESS_TOKEN_TTL_SECONDS } from "../../shared/constants";
import { issueAccessToken, verifyAccessToken } from "./jwt";

const CONFIG = {
  jwtSecret: "jwt-test-secret".padEnd(32, "-"),
} satisfies Pick<AppConfig, "jwtSecret">;

const USER: User = {
  id: "usr_alice",
  name: "Alice",
  email: "alice@example.com",
  passwordHash: "not-in-token",
  emailVerifiedAt: 1,
  createdAt: 1,
  updatedAt: 1,
};

describe("access tokens", () => {
  it("issues and verifies the public user claims", async () => {
    const token = await issueAccessToken(CONFIG, USER, new FixedClock(Date.now()));

    await expect(verifyAccessToken(CONFIG, token)).resolves.toEqual({
      sub: USER.id,
      email: USER.email,
      name: USER.name,
    });
    expect(token).not.toContain(USER.passwordHash);
  });

  it("rejects an expired token", async () => {
    const issuedLongAgo =
      Date.now() - (ACCESS_TOKEN_TTL_SECONDS + 60) * 1_000;
    const token = await issueAccessToken(
      CONFIG,
      USER,
      new FixedClock(issuedLongAgo),
    );

    await expect(verifyAccessToken(CONFIG, token)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "Invalid or expired token",
    });
  });

  it("rejects a token signed with another secret", async () => {
    const token = await issueAccessToken(CONFIG, USER, new FixedClock(Date.now()));

    await expect(
      verifyAccessToken({ jwtSecret: "other-secret".padEnd(32, "-") }, token),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
