import type { EmailSender } from "../../domain/email/sender";
import type {
  EmailTokenRepo,
  UserRepo,
} from "../../domain/users/repo";
import { renderVerifyEmail } from "../../infrastructure/email/templates";
import type { Clock } from "../../shared/clock";
import type { AppConfig } from "../../shared/config";
import { EMAIL_VERIFY_TTL_HOURS } from "../../shared/constants";
import { randomToken, sha256Hex } from "../../shared/crypto";
import type { IdGenerator } from "../../shared/ids";
import { logEvent } from "../../shared/log";

export interface ResendVerificationDependencies {
  users: UserRepo;
  emailTokens: EmailTokenRepo;
  emailSender: EmailSender;
  clock: Clock;
  ids: IdGenerator;
  config: Pick<AppConfig, "appUrl">;
}

export class ResendVerification {
  constructor(private readonly dependencies: ResendVerificationDependencies) {}

  async execute(input: { email: string }): Promise<{ sent: true }> {
    const email = input.email.trim().toLowerCase();
    const user = await this.dependencies.users.findByEmail(email);
    if (user === null || user.emailVerifiedAt !== null) {
      return { sent: true };
    }

    const now = this.dependencies.clock.now();
    await this.dependencies.emailTokens.deleteAllForUser(
      user.id,
      "VERIFY_EMAIL",
    );
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

    const message = renderVerifyEmail(
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
    return { sent: true };
  }
}
