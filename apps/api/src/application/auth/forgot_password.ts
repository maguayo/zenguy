import type { EmailSender } from "../../domain/email/sender";
import type {
  EmailTokenRepo,
  UserRepo,
} from "../../domain/users/repo";
import { renderResetPasswordEmail } from "../../infrastructure/email/templates";
import type { Clock } from "../../shared/clock";
import type { AppConfig } from "../../shared/config";
import { PASSWORD_RESET_TTL_HOURS } from "../../shared/constants";
import { randomToken, sha256Hex } from "../../shared/crypto";
import type { IdGenerator } from "../../shared/ids";
import { logEvent } from "../../shared/log";

export interface ForgotPasswordDependencies {
  users: UserRepo;
  emailTokens: EmailTokenRepo;
  emailSender: EmailSender;
  clock: Clock;
  ids: IdGenerator;
  config: Pick<AppConfig, "appUrl">;
}

export class ForgotPassword {
  constructor(private readonly dependencies: ForgotPasswordDependencies) {}

  async execute(input: { email: string }): Promise<{ sent: true }> {
    const user = await this.dependencies.users.findByEmail(
      input.email.trim().toLowerCase(),
    );
    if (user === null) return { sent: true };

    const now = this.dependencies.clock.now();
    await this.dependencies.emailTokens.deleteAllForUser(
      user.id,
      "RESET_PASSWORD",
    );
    const tokenPlain = randomToken();
    await this.dependencies.emailTokens.insert({
      id: this.dependencies.ids.newId("tok"),
      userId: user.id,
      type: "RESET_PASSWORD",
      tokenHash: await sha256Hex(tokenPlain),
      expiresAt: now + PASSWORD_RESET_TTL_HOURS * 60 * 60 * 1_000,
      usedAt: null,
      createdAt: now,
    });

    const message = renderResetPasswordEmail(
      this.dependencies.config.appUrl,
      tokenPlain,
    );
    try {
      await this.dependencies.emailSender.send({
        ...message,
        to: [user.email],
      });
    } catch {
      logEvent("email_send_failed", { type: "RESET_PASSWORD" });
    }
    return { sent: true };
  }
}
