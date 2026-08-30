import type {
  OAuthIdentity,
  OAuthIdentityRepo,
  OAuthProvider,
} from "../../domain/users/oauth_identity";
import { one, run } from "./d1";

interface OAuthIdentityRow {
  provider: OAuthProvider;
  subject: string;
  user_id: string;
  email_at_link: string;
  created_at: number;
  updated_at: number;
}

function toIdentity(row: OAuthIdentityRow): OAuthIdentity {
  return {
    provider: row.provider,
    subject: row.subject,
    userId: row.user_id,
    emailAtLink: row.email_at_link,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class D1OAuthIdentityRepo implements OAuthIdentityRepo {
  constructor(private readonly database: D1Database) {}

  async findByProviderSubject(
    provider: OAuthProvider,
    subject: string,
  ): Promise<OAuthIdentity | null> {
    const row = await one<OAuthIdentityRow>(
      this.database
        .prepare(
          `SELECT provider, subject, user_id, email_at_link, created_at, updated_at
           FROM oauth_identities
           WHERE provider = ? AND subject = ?`,
        )
        .bind(provider, subject),
    );
    return row === null ? null : toIdentity(row);
  }

  async insertIfAbsent(identity: OAuthIdentity): Promise<boolean> {
    const result = await run(
      this.database
        .prepare(
          `INSERT OR IGNORE INTO oauth_identities
            (provider, subject, user_id, email_at_link, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          identity.provider,
          identity.subject,
          identity.userId,
          identity.emailAtLink,
          identity.createdAt,
          identity.updatedAt,
        ),
    );
    return result.meta.changes === 1;
  }
}
