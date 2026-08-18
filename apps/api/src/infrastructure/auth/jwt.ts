import { sign, verify } from "hono/jwt";
import type { User } from "../../domain/users/types";
import type { Clock } from "../../shared/clock";
import type { AppConfig } from "../../shared/config";
import { ACCESS_TOKEN_TTL_SECONDS } from "../../shared/constants";
import { AppError } from "../../shared/errors";

export interface AccessTokenClaims {
  sub: string;
  email: string;
  name: string;
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
      typeof payload.name !== "string"
    ) {
      throw new Error("invalid claims");
    }
    return {
      sub: payload.sub,
      email: payload.email,
      name: payload.name,
    };
  } catch {
    throw new AppError("UNAUTHORIZED", "Invalid or expired token");
  }
}
