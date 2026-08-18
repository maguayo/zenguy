import type {
  RefreshTokenRepo,
  UserRepo,
} from "../../domain/users/repo";
import { issueAccessToken } from "../../infrastructure/auth/jwt";
import type { Clock } from "../../shared/clock";
import type { AppConfig } from "../../shared/config";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_DAYS,
} from "../../shared/constants";
import { randomToken, sha256Hex } from "../../shared/crypto";
import { AppError } from "../../shared/errors";
import type { IdGenerator } from "../../shared/ids";
import { logEvent } from "../../shared/log";
import type { AuthSession } from "./login";

export interface RefreshDependencies {
  users: UserRepo;
  refreshTokens: RefreshTokenRepo;
  clock: Clock;
  ids: IdGenerator;
  config: Pick<AppConfig, "jwtSecret">;
}

function unauthorized(): AppError {
  return new AppError("UNAUTHORIZED", "Invalid or expired refresh token");
}

export class Refresh {
  constructor(private readonly dependencies: RefreshDependencies) {}

  async execute(input: { refreshTokenPlain: string }): Promise<AuthSession> {
    const now = this.dependencies.clock.now();
    const current = await this.dependencies.refreshTokens.findByHash(
      await sha256Hex(input.refreshTokenPlain),
    );
    if (current === null) throw unauthorized();

    if (current.revokedAt !== null) {
      await this.dependencies.refreshTokens.revokeAllForUser(
        current.userId,
        now,
      );
      logEvent("refresh_reuse_detected", { userId: current.userId });
      throw unauthorized();
    }
    if (current.expiresAt <= now) throw unauthorized();

    const user = await this.dependencies.users.findById(current.userId);
    if (user === null) throw unauthorized();

    const refreshTokenPlain = randomToken();
    const replacementId = this.dependencies.ids.newId("rt");
    await this.dependencies.refreshTokens.insert({
      id: replacementId,
      userId: user.id,
      tokenHash: await sha256Hex(refreshTokenPlain),
      expiresAt: now + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1_000,
      revokedAt: null,
      replacedById: null,
      createdAt: now,
    });
    await this.dependencies.refreshTokens.revoke(
      current.id,
      now,
      replacementId,
    );

    return {
      user,
      accessToken: await issueAccessToken(
        this.dependencies.config,
        user,
        this.dependencies.clock,
      ),
      refreshTokenPlain,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    };
  }
}
