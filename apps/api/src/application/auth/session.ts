import type { RefreshTokenRepo } from "../../domain/users/repo";
import type { RefreshToken, User } from "../../domain/users/types";
import { issueAccessToken } from "../../infrastructure/auth/jwt";
import type { Clock } from "../../shared/clock";
import type { AppConfig } from "../../shared/config";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_DAYS,
} from "../../shared/constants";
import { randomToken, sha256Hex } from "../../shared/crypto";
import type { IdGenerator } from "../../shared/ids";

/** Which first-party client performed an auth action; stored as the activity `source`. */
export type AuthClient = "web" | "app";

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

export interface PreparedSession {
  session: AuthSession;
  refreshToken: RefreshToken;
}

/** Builds credentials without making them live in storage. */
export async function prepareSession(
  dependencies: SessionDependencies,
  user: User,
  options: { refreshTokenId?: string } = {},
): Promise<PreparedSession> {
  const now = dependencies.clock.now();
  const refreshTokenPlain = randomToken();
  const refreshToken: RefreshToken = {
    id: options.refreshTokenId ?? dependencies.ids.newId("rt"),
    userId: user.id,
    tokenHash: await sha256Hex(refreshTokenPlain),
    expiresAt: now + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1_000,
    revokedAt: null,
    replacedById: null,
    createdAt: now,
  };
  return {
    refreshToken,
    session: {
      user,
      accessToken: await issueAccessToken(
        dependencies.config,
        user,
        dependencies.clock,
      ),
      refreshTokenPlain,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    },
  };
}

/**
 * Opens a live session for `user`: a short-lived access token plus a refresh
 * token whose hash is persisted. Password login and inbox verification use
 * this helper; registration deliberately uses only `prepareSession` so its
 * response cannot reveal whether the email already existed.
 */
export async function createSession(
  dependencies: SessionDependencies,
  user: User,
  options: { refreshTokenId?: string } = {},
): Promise<AuthSession> {
  const prepared = await prepareSession(dependencies, user, options);
  await dependencies.refreshTokens.insert(prepared.refreshToken);
  return prepared.session;
}
