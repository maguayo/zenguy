import type {
  SessionSecurityRepo,
  UserRepo,
} from "../../domain/users/repo";
import { sha256Hex } from "../../shared/crypto";
import { AppError } from "../../shared/errors";
import { logEvent } from "../../shared/log";
import {
  prepareSession,
  type AuthSession,
  type SessionDependencies,
} from "./session";

export interface RefreshDependencies extends SessionDependencies {
  users: UserRepo;
  sessionSecurity: SessionSecurityRepo;
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
      await this.dependencies.sessionSecurity.revokeAllForUser(
        current.userId,
        now,
        "refresh_reuse",
      );
      logEvent("refresh_reuse_detected", { userId: current.userId });
      throw unauthorized();
    }
    if (current.expiresAt <= now) throw unauthorized();

    const user = await this.dependencies.users.findById(current.userId);
    if (user === null) throw unauthorized();

    const prepared = await prepareSession(this.dependencies, user, {
      refreshTokenId: this.dependencies.ids.newId("rt"),
    });
    const rotated = await this.dependencies.refreshTokens.rotate(
      current.id,
      prepared.refreshToken,
      now,
    );
    if (!rotated) {
      await this.dependencies.sessionSecurity.revokeAllForUser(
        current.userId,
        now,
        "refresh_reuse",
      );
      logEvent("refresh_reuse_detected", { userId: current.userId });
      throw unauthorized();
    }
    return prepared.session;
  }
}
