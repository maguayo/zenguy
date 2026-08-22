import type { UserRepo } from "../../domain/users/repo";
import { verifyPassword } from "../../shared/crypto";
import { AppError } from "../../shared/errors";
import {
  createSession,
  type AuthSession,
  type SessionDependencies,
} from "./session";

export type { AuthSession } from "./session";

export interface LoginDependencies extends SessionDependencies {
  users: UserRepo;
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

    return createSession(this.dependencies, user);
  }
}
