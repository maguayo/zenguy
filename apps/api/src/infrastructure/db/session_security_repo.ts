import type {
  SessionRevocationReason,
  SessionSecurityRepo,
} from "../../domain/users/repo";
import { batch } from "./d1";

/**
 * Invalidates every bearer channel owned by a user in one D1 transaction.
 * `admin_sessions` is created by migration 0026 and is intentionally included
 * here so a password reset also terminates the separate admin cookie.
 */
export class D1SessionSecurityRepo implements SessionSecurityRepo {
  constructor(private readonly database: D1Database) {}

  private statements(
    userId: string,
    at: number,
    reason: SessionRevocationReason,
  ): D1PreparedStatement[] {
    return [
      this.database
        .prepare(
          `UPDATE refresh_tokens
           SET revoked_at = COALESCE(revoked_at, ?),
               token_hash = lower(hex(randomblob(32)))
           WHERE user_id = ?`,
        )
        .bind(at, userId),
      this.database
        .prepare(
          `UPDATE admin_sessions SET revoked_at = ?
           WHERE user_id = ? AND revoked_at IS NULL`,
        )
        .bind(at, userId),
      this.database
        .prepare(
          `UPDATE user_push_devices
           SET enabled = 0, disabled_reason = ?, updated_at = ?
           WHERE user_id = ? AND enabled = 1`,
        )
        .bind(reason, at, userId),
    ];
  }

  async revokeAllForUser(
    userId: string,
    at: number,
    reason: SessionRevocationReason,
  ): Promise<void> {
    await batch(this.database, [
      this.database
        .prepare(
          `UPDATE users
           SET auth_version = auth_version + 1, updated_at = ?
           WHERE id = ?`,
        )
        .bind(at, userId),
      ...this.statements(userId, at, reason),
    ]);
  }

  async resetPasswordAndRevokeAll(
    userId: string,
    passwordHash: string,
    at: number,
  ): Promise<void> {
    await batch(this.database, [
      this.database
        .prepare(
          `UPDATE users
           SET password_hash = ?, auth_version = auth_version + 1,
               updated_at = ?
           WHERE id = ?`,
        )
        .bind(passwordHash, at, userId),
      ...this.statements(userId, at, "password_reset"),
    ]);
  }
}
