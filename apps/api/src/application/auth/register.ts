import type { EmailSender } from "../../domain/email/sender";
import type {
  EmailTokenRepo,
  UserRepo,
} from "../../domain/users/repo";
import type { User } from "../../domain/users/types";
import { renderWelcomeEmail } from "../../infrastructure/email/templates";
import type { Clock } from "../../shared/clock";
import type { AppConfig } from "../../shared/config";
import { EMAIL_VERIFY_TTL_HOURS } from "../../shared/constants";
import { hashPassword, randomToken, sha256Hex } from "../../shared/crypto";
import { conflict, validation } from "../../shared/errors";
import type { IdGenerator } from "../../shared/ids";
import { logEvent } from "../../shared/log";

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
}

export interface RegisterDependencies {
  users: UserRepo;
  emailTokens: EmailTokenRepo;
  emailSender: EmailSender;
  clock: Clock;
  ids: IdGenerator;
  config: Pick<AppConfig, "appUrl">;
}

function normalizeInput(input: RegisterInput): RegisterInput {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const details: { field: string; message: string }[] = [];
  if (name.length < 1 || name.length > 80) {
    details.push({ field: "name", message: "Must be between 1 and 80 characters" });
  }
  if (input.password.length < 8 || input.password.length > 100) {
    details.push({
      field: "password",
      message: "Must be between 8 and 100 characters",
    });
  }
  if (details.length > 0) throw validation(details);
  return { name, email, password: input.password };
}

export class Register {
  constructor(private readonly dependencies: RegisterDependencies) {}

  async execute(rawInput: RegisterInput): Promise<User> {
    const input = normalizeInput(rawInput);
    if ((await this.dependencies.users.findByEmail(input.email)) !== null) {
      throw conflict("An account with this email already exists");
    }

    const now = this.dependencies.clock.now();
    const user: User = {
      id: this.dependencies.ids.newId("usr"),
      name: input.name,
      email: input.email,
      passwordHash: await hashPassword(input.password),
      emailVerifiedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.dependencies.users.insert(user);

    const tokenPlain = randomToken();
    await this.dependencies.emailTokens.insert({
      id: this.dependencies.ids.newId("tok"),
      userId: user.id,
      type: "VERIFY_EMAIL",
      tokenHash: await sha256Hex(tokenPlain),
      expiresAt: now + EMAIL_VERIFY_TTL_HOURS * 60 * 60 * 1_000,
      usedAt: null,
      createdAt: now,
    });

    const message = renderWelcomeEmail(
      this.dependencies.config.appUrl,
      user.name,
      tokenPlain,
    );
    try {
      await this.dependencies.emailSender.send({
        ...message,
        to: [user.email],
      });
    } catch {
      logEvent("email_send_failed", { type: "VERIFY_EMAIL" });
    }

    return user;
  }
}
