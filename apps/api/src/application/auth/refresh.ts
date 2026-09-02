import type {
  SessionSecurityRepo,
  UserRepo,
} from "../../domain/users/repo";
import type { RefreshToken } from "../../domain/users/types";
import { REFRESH_REUSE_GRACE_MS } from "../../shared/constants";
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

/** Bounded walk from a rotated token to the live head of its chain. */
const CHAIN_WALK_LIMIT = 8;
/** Lost rotations against a head that keeps moving under us. */
const ROTATION_ATTEMPTS = 3;

function unauthorized(): AppError {
  return new AppError("UNAUTHORIZED", "Invalid or expired refresh token");
}

/**
 * Rotates a refresh token. Presenting a token that was already rotated is
 * reuse, which revokes every session and push device of the user — unless the
 * rotation happened within `REFRESH_REUSE_GRACE_MS`. That short window is a
 * client race, not theft: two browser tabs refreshing the shared cookie at the
 * same moment, or a native app retrying after it lost the rotation response.
 * Such a caller is moved to the head of the chain instead of being locked out.
 */
export class Refresh {
  constructor(private readonly dependencies: RefreshDependencies) {}

  async execute(input: { refreshTokenPlain: string }): Promise<AuthSession> {
    const now = this.dependencies.clock.now();
    const presented = await this.dependencies.refreshTokens.findByHash(
      await sha256Hex(input.refreshTokenPlain),
    );
    if (presented === null) throw unauthorized();

    let current = presented;
    if (presented.revokedAt !== null) {
      const head = await this.liveHeadWithinGrace(presented, now);
      if (head === null) throw await this.reuse(presented.userId, now);
      logEvent("refresh_reuse_grace", { userId: presented.userId });
      current = head;
    }
    if (current.expiresAt <= now) throw unauthorized();

    const user = await this.dependencies.users.findById(current.userId);
    if (user === null) throw unauthorized();

    for (let attempt = 0; attempt < ROTATION_ATTEMPTS; attempt += 1) {
      const prepared = await prepareSession(this.dependencies, user, {
        refreshTokenId: this.dependencies.ids.newId("rt"),
      });
      if (
        await this.dependencies.refreshTokens.rotate(
          current.id,
          prepared.refreshToken,
          now,
        )
      ) {
        return prepared.session;
      }
      // Another caller rotated `current` first. Within the grace window that
      // is the same client racing itself: continue from the new head.
      const latest = await this.dependencies.refreshTokens.findById(current.id);
      const head =
        latest === null || latest.revokedAt === null
          ? null
          : await this.liveHeadWithinGrace(latest, now);
      if (head === null) throw await this.reuse(current.userId, now);
      logEvent("refresh_reuse_grace", { userId: current.userId });
      current = head;
    }
    throw unauthorized();
  }

  private async liveHeadWithinGrace(
    rotated: RefreshToken,
    now: number,
  ): Promise<RefreshToken | null> {
    let token = rotated;
    for (let hops = 0; hops < CHAIN_WALK_LIMIT; hops += 1) {
      if (
        token.revokedAt === null ||
        token.revokedAt < now - REFRESH_REUSE_GRACE_MS ||
        token.replacedById === null
      ) {
        // Revoked outright (logout, reuse, password reset) or rotated too
        // long ago to be a race.
        return null;
      }
      const next = await this.dependencies.refreshTokens.findById(
        token.replacedById,
      );
      if (next === null || next.userId !== rotated.userId) return null;
      if (next.revokedAt === null) return next;
      token = next;
    }
    return null;
  }

  private async reuse(userId: string, now: number): Promise<AppError> {
    await this.dependencies.sessionSecurity.revokeAllForUser(
      userId,
      now,
      "refresh_reuse",
    );
    logEvent("refresh_reuse_detected", { userId });
    return unauthorized();
  }
}
