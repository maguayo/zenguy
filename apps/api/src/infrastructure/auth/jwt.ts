import { sign, verify } from "hono/jwt";
import type { User } from "../../domain/users/types";
import type { Clock } from "../../shared/clock";
import type { AppConfig } from "../../shared/config";
import { ACCESS_TOKEN_TTL_SECONDS } from "../../shared/constants";
import { AppError } from "../../shared/errors";
import { randomToken } from "../../shared/crypto";

export const ACCESS_TOKEN_ISSUER = "https://api.zenguy.com";
export const ACCESS_TOKEN_AUDIENCE = "zenguy-app";

export interface AccessTokenClaims {
  sub: string;
  email: string;
  name: string;
  iss: typeof ACCESS_TOKEN_ISSUER;
  aud: typeof ACCESS_TOKEN_AUDIENCE;
  tokenType: "access";
  jti: string;
  authVersion: number;
}

type JwtConfig = Pick<AppConfig, "jwtSecret">;

export async function issueAccessToken(
  config: JwtConfig,
  user: User,
  clock: Clock,
): Promise<string> {
  const issuedAt = Math.floor(clock.now() / 1_000);
  return sign(
    {
      sub: user.id,
      email: user.email,
      name: user.name,
      iss: ACCESS_TOKEN_ISSUER,
      aud: ACCESS_TOKEN_AUDIENCE,
      token_type: "access",
      jti: randomToken(16),
      ver: user.authVersion,
      iat: issuedAt,
      exp: issuedAt + ACCESS_TOKEN_TTL_SECONDS,
    },
    config.jwtSecret,
    "HS256",
  );
}

export async function verifyAccessToken(
  config: JwtConfig,
  token: string,
): Promise<AccessTokenClaims> {
  try {
    const payload = await verify(token, config.jwtSecret, "HS256");
    if (
      typeof payload.sub !== "string" ||
      typeof payload.email !== "string" ||
      typeof payload.name !== "string" ||
      payload.iss !== ACCESS_TOKEN_ISSUER ||
      payload.aud !== ACCESS_TOKEN_AUDIENCE ||
      payload.token_type !== "access" ||
      typeof payload.jti !== "string" ||
      payload.jti.length < 16 ||
      typeof payload.ver !== "number" ||
      !Number.isSafeInteger(payload.ver) ||
      payload.ver < 1
    ) {
      throw new Error("invalid claims");
    }
    return {
      sub: payload.sub,
      email: payload.email,
      name: payload.name,
      iss: ACCESS_TOKEN_ISSUER,
      aud: ACCESS_TOKEN_AUDIENCE,
      tokenType: "access",
      jti: payload.jti,
      authVersion: payload.ver,
    };
  } catch {
    throw new AppError("UNAUTHORIZED", "Invalid or expired token");
  }
}
