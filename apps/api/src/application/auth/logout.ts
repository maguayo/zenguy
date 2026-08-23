import { ACTIVITY_EVENTS } from "../../domain/activity/catalog";
import type {
  RefreshTokenRepo,
  SessionSecurityRepo,
} from "../../domain/users/repo";
import type { Clock } from "../../shared/clock";
import { sha256Hex } from "../../shared/crypto";
import type { TrackEvent } from "../activity/track_event";
import type { AuthClient } from "./session";

export interface LogoutDependencies {
  refreshTokens: RefreshTokenRepo;
  sessionSecurity: SessionSecurityRepo;
  clock: Clock;
  track?: Pick<TrackEvent, "execute">;
}

export class Logout {
  constructor(private readonly dependencies: LogoutDependencies) {}

  async execute(input: {
    refreshTokenPlain: string | null;
    client: AuthClient;
  }): Promise<{ loggedOut: true }> {
    if (input.refreshTokenPlain === null) return { loggedOut: true };

    const token = await this.dependencies.refreshTokens.findByHash(
      await sha256Hex(input.refreshTokenPlain),
    );
    if (token !== null) {
      await this.dependencies.sessionSecurity.revokeAllForUser(
        token.userId,
        this.dependencies.clock.now(),
        "logout",
      );
      await this.dependencies.track?.execute({
        type: ACTIVITY_EVENTS.userLoggedOut,
        userId: token.userId,
        source: input.client,
      });
    }
    return { loggedOut: true };
  }
}
