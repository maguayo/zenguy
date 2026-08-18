import type {
  RefreshTokenRepo,
  UserRepo,
} from "../../domain/users/repo";
import type { User } from "../../domain/users/types";
import { issueAccessToken } from "../../infrastructure/auth/jwt";
import type { Clock } from "../../shared/clock";
import type { AppConfig } from "../../shared/config";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_DAYS,
} from "../../shared/constants";
import { randomToken, sha256Hex, verifyPassword } from "../../shared/crypto";
import { AppError } from "../../shared/errors";
import type { IdGenerator } from "../../shared/ids";

export interface AuthSession {
  user: User;
  accessToken: string;
  refreshTokenPlain: string;
  expiresIn: number;
}

export interface LoginDependencies {
  users: UserRepo;
  refreshTokens: RefreshTokenRepo;
  clock: Clock;
  ids: IdGenerator;
  config: Pick<AppConfig, "jwtSecret">;
}

export class Login {
  constructor(private readonly dependencies: LoginDependencies) {}

  async execute(input: {
    email: string;
    password: string;
  }): Promise<AuthSession> {
    const user = await this.dependencies.users.findByEmail(
      input.email.trim().toLowerCase(),
    );
    if (
      user === null ||
      !(await verifyPassword(input.password, user.passwordHash))
    ) {
      throw new AppError(
        "INVALID_CREDENTIALS",
        "Incorrect email or password",
      );
    }

    const now = this.dependencies.clock.now();
    const refreshTokenPlain = randomToken();
    await this.dependencies.refreshTokens.insert({
      id: this.dependencies.ids.newId("rt"),
      userId: user.id,
      tokenHash: await sha256Hex(refreshTokenPlain),
      expiresAt: now + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1_000,
      revokedAt: null,
      replacedById: null,
      createdAt: now,
    });

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
