import { ACTIVITY_EVENTS } from "../../domain/activity/catalog";
import type { OAuthIdentityRepo } from "../../domain/users/oauth_identity";
import type { UserRepo } from "../../domain/users/repo";
import type { User } from "../../domain/users/types";
import { AppError, conflict } from "../../shared/errors";
import type { TrackEvent } from "../activity/track_event";
import {
  createSession,
  type AuthClient,
  type AuthSession,
  type SessionDependencies,
} from "./session";

export interface GoogleLoginDependencies extends SessionDependencies {
  users: UserRepo;
  oauthIdentities: OAuthIdentityRepo;
  track?: Pick<TrackEvent, "execute">;
}

export interface GoogleIdentityClaims {
  subject: string;
  email: string;
  name: string | null;
  hostedDomain: string | null;
}

function linkRequired(): AppError {
  return new AppError(
    "INVALID_CREDENTIALS",
    "A verified Zenguy account is required before Google can be linked",
  );
}

function googleIsAuthoritativeForEmail(
  email: string,
  hostedDomain: string | null,
): boolean {
  const domain = email.slice(email.lastIndexOf("@") + 1);
  // Google remains authoritative for Gmail addresses and for accounts whose
  // signed `hd` claim proves they are managed by a Workspace organization.
  // For other providers, email_verified can be historical after reassignment.
  return (
    domain === "gmail.com" ||
    domain === "googlemail.com" ||
    hostedDomain !== null
  );
}

/**
 * Signs an existing, verified Zenguy account in with Google's stable subject.
 * Account creation remains on the explicit registration flow so OAuth cannot
 * bypass the product's terms/privacy acceptance or inbox-verification gates.
 */
export class GoogleLogin {
  constructor(private readonly dependencies: GoogleLoginDependencies) {}

  async execute(input: GoogleIdentityClaims & {
    client: AuthClient;
  }): Promise<AuthSession> {
    const email = input.email.trim().toLowerCase();
    const linkedIdentity =
      await this.dependencies.oauthIdentities.findByProviderSubject(
        "google",
        input.subject,
      );

    let user: User;
    if (linkedIdentity !== null) {
      const linkedUser = await this.dependencies.users.findById(
        linkedIdentity.userId,
      );
      if (linkedUser === null) {
        // A foreign-key-backed identity must never outlive its user. Treat a
        // broken invariant as an internal error instead of silently relinking.
        throw new Error("Google identity references a missing user");
      }
      user = linkedUser;
    } else {
      const matchingUser = await this.dependencies.users.findByEmail(email);
      if (
        matchingUser === null ||
        matchingUser.emailVerifiedAt === null ||
        !googleIsAuthoritativeForEmail(email, input.hostedDomain)
      ) {
        throw linkRequired();
      }
      user = matchingUser;

      const now = this.dependencies.clock.now();
      const linked = await this.dependencies.oauthIdentities.insertIfAbsent({
        provider: "google",
        subject: input.subject,
        userId: user.id,
        emailAtLink: email,
        createdAt: now,
        updatedAt: now,
      });
      if (!linked) {
        const racedIdentity =
          await this.dependencies.oauthIdentities.findByProviderSubject(
            "google",
            input.subject,
          );
        if (racedIdentity === null || racedIdentity.userId !== user.id) {
          throw conflict("This Google account is already linked");
        }
      }
    }

    const session = await createSession(this.dependencies, user);
    await this.dependencies.track?.execute({
      type: ACTIVITY_EVENTS.userLoggedIn,
      userId: user.id,
      source: input.client,
      properties: { provider: "google" },
    });
    return session;
  }
}
