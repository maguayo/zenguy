import type {
  EmailTokenRepo,
  UserRepo,
} from "../../domain/users/repo";
import { sha256Hex } from "../../shared/crypto";
import { AppError } from "../../shared/errors";
import {
  createSession,
  type AuthSession,
  type SessionDependencies,
} from "./session";

export interface VerifyEmailDependencies extends SessionDependencies {
  users: UserRepo;
  emailTokens: EmailTokenRepo;
}

function gone(): AppError {
  return new AppError(
    "GONE",
    "This verification link is invalid or has expired",
  );
}

export class VerifyEmail {
  constructor(private readonly dependencies: VerifyEmailDependencies) {}

  /**
   * Consuming the single-use link proves control of the inbox, so the user is
   * signed in on the device that opened it instead of being sent to the
   * password form again.
   */
  async execute(input: { token: string }): Promise<AuthSession> {
    const now = this.dependencies.clock.now();
    const token = await this.dependencies.emailTokens.findValidByHash(
      await sha256Hex(input.token),
      "VERIFY_EMAIL",
      now,
    );
    if (token === null) throw gone();

    await this.dependencies.users.setEmailVerified(token.userId, now);
    await this.dependencies.emailTokens.markUsed(token.id, now);
    const user = await this.dependencies.users.findById(token.userId);
    if (user === null) throw gone();

    return createSession(this.dependencies, user);
  }
}
