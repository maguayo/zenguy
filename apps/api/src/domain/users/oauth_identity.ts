export type OAuthProvider = "google";

export interface OAuthIdentity {
  provider: OAuthProvider;
  subject: string;
  userId: string;
  emailAtLink: string;
  createdAt: number;
  updatedAt: number;
}

export interface OAuthIdentityRepo {
  findByProviderSubject(
    provider: OAuthProvider,
    subject: string,
  ): Promise<OAuthIdentity | null>;
  /** Constraint-backed link; false means the subject or user is already linked. */
  insertIfAbsent(identity: OAuthIdentity): Promise<boolean>;
}
