import type {
  EmailTokenRepo,
  RefreshTokenRepo,
  UserRepo,
} from "../../domain/users/repo";
import type { Clock } from "../../shared/clock";
import { hashPassword, sha256Hex } from "../../shared/crypto";
import { AppError } from "../../shared/errors";

export interface ResetPasswordDependencies {
  users: UserRepo;
  emailTokens: EmailTokenRepo;
  refreshTokens: RefreshTokenRepo;
  clock: Clock;
}

export class ResetPassword {
  constructor(private readonly dependencies: ResetPasswordDependencies) {}

  async execute(input: {
    token: string;
    password: string;
  }): Promise<{ reset: true }> {
    const now = this.dependencies.clock.now();
    const token = await this.dependencies.emailTokens.findValidByHash(
      await sha256Hex(input.token),
      "RESET_PASSWORD",
      now,
    );
    if (token === null) {
      throw new AppError(
        "GONE",
        "This password reset link is invalid or has expired",
      );
    }

    await this.dependencies.users.setPassword(
      token.userId,
      await hashPassword(input.password),
      now,
    );
    await this.dependencies.emailTokens.markUsed(token.id, now);
    await this.dependencies.refreshTokens.revokeAllForUser(token.userId, now);
    return { reset: true };
  }
}
