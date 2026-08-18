import type { RefreshTokenRepo } from "../../domain/users/repo";
import type { Clock } from "../../shared/clock";
import { sha256Hex } from "../../shared/crypto";

export interface LogoutDependencies {
  refreshTokens: RefreshTokenRepo;
  clock: Clock;
}

export class Logout {
  constructor(private readonly dependencies: LogoutDependencies) {}

  async execute(input: {
    refreshTokenPlain: string | null;
  }): Promise<{ loggedOut: true }> {
    if (input.refreshTokenPlain === null) return { loggedOut: true };

    const token = await this.dependencies.refreshTokens.findByHash(
      await sha256Hex(input.refreshTokenPlain),
    );
    if (token !== null) {
      await this.dependencies.refreshTokens.revoke(
        token.id,
        this.dependencies.clock.now(),
      );
    }
    return { loggedOut: true };
  }
}
