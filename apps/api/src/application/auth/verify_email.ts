import { ACTIVITY_EVENTS } from "../../domain/activity/catalog";
import type {
  EmailTokenRepo,
  UserRepo,
} from "../../domain/users/repo";
import { sha256Hex, verifyPassword } from "../../shared/crypto";
import { AppError } from "../../shared/errors";
import type { TrackEvent } from "../activity/track_event";
import {
  createSession,
  type AuthClient,
  type AuthSession,
  type SessionDependencies,
} from "./session";

export interface VerifyEmailDependencies extends SessionDependencies {
  users: UserRepo;
  emailTokens: EmailTokenRepo;
  track?: Pick<TrackEvent, "execute">;
}

function gone(): AppError {
  return new AppError(
    "GONE",
    "This verification link is invalid or has expired",
  );
}

export class VerifyEmail {
  constructor(
    private readonly dependencies: VerifyEmailDependencies,
    private readonly passwordVerifier: (
      password: string,
      stored: string,
    ) => Promise<boolean> = verifyPassword,
  ) {}

  /**
   * Verification requires both factors from the original registration: the
   * inbox link and its password. Looking up the live token before PBKDF2 keeps
   * random-token floods cheap; consuming it only after the password succeeds
   * prevents an unsolicited registration from becoming a pre-account
   * takeover when the mailbox owner opens the link.
   */
  async execute(input: {
    token: string;
    password: string;
    client: AuthClient;
  }): Promise<AuthSession> {
    const now = this.dependencies.clock.now();
    const tokenHash = await sha256Hex(input.token);
    const candidate = await this.dependencies.emailTokens.findValidByHash(
      tokenHash,
      "VERIFY_EMAIL",
      now,
    );
    if (candidate === null) throw gone();

    const candidateUser = await this.dependencies.users.findById(
      candidate.userId,
    );
    if (candidateUser === null) throw gone();
    if (!(await this.passwordVerifier(input.password, candidateUser.passwordHash))) {
      throw new AppError("INVALID_CREDENTIALS", "Incorrect password");
    }

    // This is the single-use claim. Concurrent requests may both validate the
    // password, but only one is allowed to verify the account and mint a
    // session. A failed password never reaches this mutation.
    const token = await this.dependencies.emailTokens.consumeValidByHash(
      tokenHash,
      "VERIFY_EMAIL",
      now,
    );
    if (token === null || token.userId !== candidate.userId) throw gone();

    await this.dependencies.users.setEmailVerified(token.userId, now);
    const user = await this.dependencies.users.findById(token.userId);
    if (
      user === null ||
      user.passwordHash !== candidateUser.passwordHash ||
      user.authVersion !== candidateUser.authVersion
    ) {
      // A password reset won the race after the proof was calculated. The
      // inbox remains verified, but the stale password must never mint a live
      // session.
      throw gone();
    }

    // The session is persisted first so a failed refresh-token insert never
    // records a login that produced no session.
    const refreshTokenId = this.dependencies.ids.newId("rt");
    const session = await createSession(this.dependencies, user, {
      refreshTokenId,
    });
    const currentUser = await this.dependencies.users.findById(user.id);
    if (
      currentUser === null ||
      currentUser.passwordHash !== user.passwordHash ||
      currentUser.authVersion !== user.authVersion
    ) {
      // Close the second race window around refresh-token insertion. If reset
      // happened first, revoke the newly inserted token; if it happens after
      // this check, reset's atomic revoke-all sees and invalidates it itself.
      await this.dependencies.refreshTokens.revoke(refreshTokenId, now);
      throw gone();
    }
    await this.dependencies.track?.execute({
      type: ACTIVITY_EVENTS.userEmailVerified,
      userId: user.id,
      source: input.client,
    });
    return session;
  }
}
