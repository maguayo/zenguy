import type { User } from "../../domain/users/types";
import { FixedClock } from "../../shared/clock";
import type { AppConfig } from "../../shared/config";
import { ACCESS_TOKEN_TTL_SECONDS } from "../../shared/constants";
import { issueAccessToken, verifyAccessToken } from "./jwt";
import { sign } from "hono/jwt";

const CONFIG = {
  jwtSecret: "jwt-test-secret".padEnd(32, "-"),
} satisfies Pick<AppConfig, "jwtSecret">;

const USER: User = {
  id: "usr_alice",
  name: "Alice",
  email: "alice@example.com",
  passwordHash: "not-in-token",
  emailVerifiedAt: 1,
  authVersion: 1,
  createdAt: 1,
  updatedAt: 1,
};

describe("access tokens", () => {
  it("issues and verifies the public user claims", async () => {
    const token = await issueAccessToken(CONFIG, USER, new FixedClock(Date.now()));

    await expect(verifyAccessToken(CONFIG, token)).resolves.toMatchObject({
      sub: USER.id,
      email: USER.email,
      name: USER.name,
      iss: "https://api.zenguy.com",
      aud: "zenguy-app",
      tokenType: "access",
      authVersion: USER.authVersion,
      jti: expect.any(String),
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

  it("rejects signed JWTs with the wrong issuer, audience, type, or version", async () => {
    const now = Math.floor(Date.now() / 1_000);
    const token = await sign(
      {
        sub: USER.id,
        email: USER.email,
        name: USER.name,
        iss: "https://other.example",
        aud: "other-app",
        token_type: "refresh",
        jti: "valid-looking-jti-123",
        ver: 0,
        iat: now,
        exp: now + 60,
      },
      CONFIG.jwtSecret,
      "HS256",
    );

    await expect(verifyAccessToken(CONFIG, token)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("issues a unique jti for every access token", async () => {
    const clock = new FixedClock(Date.now());
    const first = await verifyAccessToken(CONFIG, await issueAccessToken(CONFIG, USER, clock));
    const second = await verifyAccessToken(CONFIG, await issueAccessToken(CONFIG, USER, clock));
    expect(first.jti).not.toBe(second.jti);
  });
});
