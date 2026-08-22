import type { RefreshTokenRepo } from "../../domain/users/repo";
import type { User } from "../../domain/users/types";
import { issueAccessToken } from "../../infrastructure/auth/jwt";
import type { Clock } from "../../shared/clock";
import type { AppConfig } from "../../shared/config";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_DAYS,
} from "../../shared/constants";
import { randomToken, sha256Hex } from "../../shared/crypto";
import type { IdGenerator } from "../../shared/ids";

export interface AuthSession {
  user: User;
  accessToken: string;
  refreshTokenPlain: string;
  expiresIn: number;
}

export interface SessionDependencies {
  refreshTokens: RefreshTokenRepo;
  clock: Clock;
  ids: IdGenerator;
  config: Pick<AppConfig, "jwtSecret">;
}

/**
 * Opens a session for `user`: a short-lived access token plus a refresh token
 * whose hash is persisted. Every flow that signs a user in goes through here
 * (password login, registration, email verification, refresh rotation).
 */
export async function createSession(
  dependencies: SessionDependencies,
  user: User,
  options: { refreshTokenId?: string } = {},
): Promise<AuthSession> {
  const now = dependencies.clock.now();
  const refreshTokenPlain = randomToken();
  await dependencies.refreshTokens.insert({
    id: options.refreshTokenId ?? dependencies.ids.newId("rt"),
    userId: user.id,
    tokenHash: await sha256Hex(refreshTokenPlain),
    expiresAt: now + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1_000,
    revokedAt: null,
    replacedById: null,
    createdAt: now,
  });

  return {
    user,
    accessToken: await issueAccessToken(
      dependencies.config,
      user,
      dependencies.clock,
    ),
    refreshTokenPlain,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  };
}
