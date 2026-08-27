import { ACTIVITY_EVENTS } from "../../domain/activity/catalog";
import type { EmailSender } from "../../domain/email/sender";
import type {
  EmailTokenRepo,
  UserRepo,
} from "../../domain/users/repo";
import type { User } from "../../domain/users/types";
import {
  renderRegistrationAttemptEmail,
  renderWelcomeEmail,
} from "../../infrastructure/email/templates";
import type { LegalAcceptanceRepo } from "../../domain/users/legal_acceptance";
import { LEGAL_VERSION } from "../../shared/constants";
import type { AppConfig } from "../../shared/config";
import type { Clock } from "../../shared/clock";
import { EMAIL_VERIFY_TTL_HOURS } from "../../shared/constants";
import { hashPassword, randomToken, sha256Hex } from "../../shared/crypto";
import { validation } from "../../shared/errors";
import { logEvent } from "../../shared/log";
import type { IdGenerator } from "../../shared/ids";
import { newPasswordIssues } from "../../shared/password_policy";
import type { TrackEvent } from "../activity/track_event";
import type { AuthClient } from "./session";

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  acceptedTerms?: boolean;
  acceptedPrivacy?: boolean;
  marketingOptIn?: boolean;
}

export interface RegisterDependencies {
  users: UserRepo;
  legalAcceptances: LegalAcceptanceRepo;
  emailTokens: EmailTokenRepo;
  emailSender: EmailSender;
  config: Pick<AppConfig, "appUrl">;
  clock: Clock;
  ids: IdGenerator;
  track?: Pick<TrackEvent, "execute">;
}

export interface RegistrationPending {
  registrationPending: true;
  email: string;
}

function normalizeInput(input: RegisterInput): RegisterInput {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const details: { field: string; message: string }[] = [];
  if (name.length < 1 || name.length > 80) {
    details.push({ field: "name", message: "Must be between 1 and 80 characters" });
  }
  if (input.acceptedTerms === false) {
    details.push({ field: "acceptedTerms", message: "You must accept the Terms of Service." });
  }
  if (input.acceptedPrivacy === false) {
    details.push({
      field: "acceptedPrivacy",
      message: "You must confirm that you have read the Privacy Policy.",
    });
  }
  details.push(
    ...newPasswordIssues(input.password).map((message) => ({
      field: "password",
      message,
    })),
  );
  if (details.length > 0) throw validation(details);
  return {
    acceptedPrivacy: input.acceptedPrivacy === true,
    acceptedTerms: input.acceptedTerms === true,
    email,
    marketingOptIn: input.marketingOptIn === true,
    name,
    password: input.password,
  };
}

export class Register {
  constructor(
    private readonly dependencies: RegisterDependencies,
    private readonly passwordHasher: (password: string) => Promise<string> =
      hashPassword,
  ) {}

  private async send(
    message: Omit<Parameters<EmailSender["send"]>[0], "to">,
    email: string,
    type: "VERIFY_EMAIL" | "REGISTRATION_ATTEMPT",
  ): Promise<void> {
    try {
      await this.dependencies.emailSender.send({ ...message, to: [email] });
    } catch {
      logEvent("email_send_failed", { type });
    }
  }

  private async existingAccountResponse(
    existing: User,
    email: string,
  ): Promise<RegistrationPending> {
    await this.send(
      renderRegistrationAttemptEmail(
        this.dependencies.config.appUrl,
        existing.name,
      ),
      existing.email,
      "REGISTRATION_ATTEMPT",
    );
    return { registrationPending: true, email };
  }

  /**
   * Always returns the same token-free pending result for a new or existing
   * address. Inbox verification is the only point that opens a live session;
   * registration never signs a JWT, creates a refresh capability, or sets an
   * auth cookie for a synthetic principal.
   */
  async execute(
    rawInput: RegisterInput & { client: AuthClient },
  ): Promise<RegistrationPending> {
    const input = normalizeInput(rawInput);
    const now = this.dependencies.clock.now();
    const passwordHash = await this.passwordHasher(input.password);
    const existing = await this.dependencies.users.findByEmail(input.email);

    if (existing !== null) {
      return this.existingAccountResponse(existing, input.email);
    }

    const user: User = {
      id: this.dependencies.ids.newId("usr"),
      name: input.name,
      email: input.email,
      passwordHash,
      emailVerifiedAt: null,
      authVersion: 1,
      createdAt: now,
      updatedAt: now,
    };
    if (!(await this.dependencies.users.insertIfAbsent(user))) {
      const racedExisting = await this.dependencies.users.findByEmail(input.email);
      if (racedExisting === null) {
        throw new Error("Account creation constraint violation");
      }
      return this.existingAccountResponse(racedExisting, input.email);
    }

    if (input.acceptedTerms && input.acceptedPrivacy) {
      await this.dependencies.legalAcceptances.insert({
        userId: user.id,
        termsAcceptedAt: now,
        privacyAcknowledgedAt: now,
        marketingOptInAt: input.marketingOptIn ? now : null,
        legalVersion: LEGAL_VERSION,
        createdAt: now,
      });
    }

    // Only a real account creation is an event: the existing-email branches
    // above create nothing, so they stay silent (anti-enumeration).
    await this.dependencies.track?.execute({
      type: ACTIVITY_EVENTS.userRegistered,
      userId: user.id,
      source: rawInput.client,
    });

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
    await this.send(message, user.email, "VERIFY_EMAIL");

    return { registrationPending: true, email: input.email };
  }
}
