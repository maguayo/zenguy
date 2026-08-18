import type {
  EmailTokenRepo,
  UserRepo,
} from "../../domain/users/repo";
import type { Clock } from "../../shared/clock";
import { sha256Hex } from "../../shared/crypto";
import { AppError } from "../../shared/errors";

export interface VerifyEmailDependencies {
  users: UserRepo;
  emailTokens: EmailTokenRepo;
  clock: Clock;
}

export class VerifyEmail {
  constructor(private readonly dependencies: VerifyEmailDependencies) {}

  async execute(input: { token: string }): Promise<{ verified: true }> {
    const now = this.dependencies.clock.now();
    const token = await this.dependencies.emailTokens.findValidByHash(
      await sha256Hex(input.token),
      "VERIFY_EMAIL",
      now,
    );
    if (token === null) {
      throw new AppError(
        "GONE",
        "This verification link is invalid or has expired",
      );
    }

    await this.dependencies.users.setEmailVerified(token.userId, now);
    await this.dependencies.emailTokens.markUsed(token.id, now);
    return { verified: true };
  }
}
