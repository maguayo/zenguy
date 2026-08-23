import { ACTIVITY_EVENTS } from "../../domain/activity/catalog";
import type { UserRepo } from "../../domain/users/repo";
import {
  hashPassword,
  passwordNeedsRehash,
  verifyPassword,
} from "../../shared/crypto";
import { AppError } from "../../shared/errors";
import {
  PASSWORD_HASH_SCHEME,
  PASSWORD_HASH_VERSION,
  PBKDF2_ITERATIONS,
} from "../../shared/constants";
import type { TrackEvent } from "../activity/track_event";
import {
  createSession,
  type AuthClient,
  type AuthSession,
  type SessionDependencies,
} from "./session";

// A syntactically valid PBKDF2 record makes an unknown-account login pay the
// same expensive KDF cost as a wrong password for an existing account.
export const DUMMY_PASSWORD_HASH =
  `${PASSWORD_HASH_SCHEME}$${PASSWORD_HASH_VERSION}$${PBKDF2_ITERATIONS}$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=`;

export type { AuthSession } from "./session";

export interface LoginDependencies extends SessionDependencies {
  users: UserRepo;
  track?: Pick<TrackEvent, "execute">;
}

function invalidCredentials(): AppError {
  return new AppError(
    "INVALID_CREDENTIALS",
    "Incorrect email or password",
  );
}

export class Login {
  constructor(private readonly dependencies: LoginDependencies) {}

  async execute(input: {
    email: string;
    password: string;
    client: AuthClient;
  }): Promise<AuthSession> {
    const user = await this.dependencies.users.findByEmail(
      input.email.trim().toLowerCase(),
    );
    const passwordMatches = await verifyPassword(
      input.password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );
    if (user === null || !passwordMatches) {
      throw invalidCredentials();
    }

    let sessionUser = user;
    if (passwordNeedsRehash(user.passwordHash)) {
      const replacementPasswordHash = await hashPassword(input.password);
      const rehashed = await this.dependencies.users.rehashPasswordIfUnchanged(
        user.id,
        user.passwordHash,
        replacementPasswordHash,
        this.dependencies.clock.now(),
      );
      // A password reset (or another security-sensitive password write) won
      // the race after verification. Fail closed instead of opening a session
      // from the stale credential snapshot. A concurrent one-time legacy
      // rehash may also make this caller retry, which is deliberately safe.
      if (!rehashed) throw invalidCredentials();
      sessionUser = { ...user, passwordHash: replacementPasswordHash };
    }

    // Preassign the refresh ID so it can be revoked if a password reset wins
    // immediately after the password check but before/while the token insert
    // commits. The post-insert read closes the opposite ordering too: a reset
    // that completed just before insert changes password/authVersion, so this
    // request never returns the newly inserted stale capability.
    const refreshTokenId = this.dependencies.ids.newId("rt");
    const session = await createSession(this.dependencies, sessionUser, {
      refreshTokenId,
    });
    const currentUser = await this.dependencies.users.findById(user.id);
    if (
      currentUser === null ||
      currentUser.passwordHash !== sessionUser.passwordHash ||
      currentUser.authVersion !== sessionUser.authVersion
    ) {
      await this.dependencies.refreshTokens.revoke(
        refreshTokenId,
        this.dependencies.clock.now(),
      );
      throw invalidCredentials();
    }
    await this.dependencies.track?.execute({
      type: ACTIVITY_EVENTS.userLoggedIn,
      userId: user.id,
      source: input.client,
    });
    return session;
  }
}
