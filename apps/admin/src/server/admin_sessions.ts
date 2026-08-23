export interface AdminIdentity {
  userId: string;
  email: string;
  authVersion: number;
}

export interface CreateAdminSessionInput extends AdminIdentity {
  idHash: string;
  createdAt: number;
  expiresAt: number;
}

export interface AdminSessionStore {
  findEligibleIdentity(userId: string, email: string): Promise<AdminIdentity | null>;
  create(input: CreateAdminSessionInput): Promise<void>;
  findActive(idHash: string, now: number): Promise<AdminIdentity | null>;
  revoke(idHash: string, now: number): Promise<void>;
}

interface IdentityRow {
  user_id: string;
  email: string;
  auth_version: number;
}

function identity(row: IdentityRow | null): AdminIdentity | null {
  return row === null
    ? null
    : { userId: row.user_id, email: row.email, authVersion: row.auth_version };
}

/** D1-backed, opaque and immediately revocable admin sessions. */
export class D1AdminSessionStore implements AdminSessionStore {
  constructor(private readonly db: D1Database) {}

  async findEligibleIdentity(userId: string, email: string): Promise<AdminIdentity | null> {
    const row = await this.db
      .prepare(
        `SELECT id AS user_id, email, auth_version
           FROM users
          WHERE id = ? AND email = ? COLLATE NOCASE AND email_verified_at IS NOT NULL`,
      )
      .bind(userId, email)
      .first<IdentityRow>();
    return identity(row);
  }

  async create(input: CreateAdminSessionInput): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO admin_sessions
           (id_hash, user_id, email, auth_version, created_at, expires_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      )
      .bind(
        input.idHash,
        input.userId,
        input.email,
        input.authVersion,
        input.createdAt,
        input.expiresAt,
      )
      .run();
  }

  async findActive(idHash: string, now: number): Promise<AdminIdentity | null> {
    const row = await this.db
      .prepare(
        `SELECT sessions.user_id, users.email, users.auth_version
           FROM admin_sessions AS sessions
           JOIN users ON users.id = sessions.user_id
          WHERE sessions.id_hash = ?
            AND sessions.revoked_at IS NULL
            AND sessions.expires_at > ?
            AND sessions.auth_version = users.auth_version
            AND sessions.email = users.email COLLATE NOCASE
            AND users.email_verified_at IS NOT NULL`,
      )
      .bind(idHash, now)
      .first<IdentityRow>();
    return identity(row);
  }

  async revoke(idHash: string, now: number): Promise<void> {
    await this.db
      .prepare(
        `UPDATE admin_sessions
            SET revoked_at = COALESCE(revoked_at, ?)
          WHERE id_hash = ?`,
      )
      .bind(now, idHash)
      .run();
  }
}
