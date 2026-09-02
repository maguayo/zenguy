import type { RefreshTokenRepo } from "../../domain/users/repo";
import type { RefreshToken } from "../../domain/users/types";
import { batch, one, run } from "./d1";

interface RefreshTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: number;
  revoked_at: number | null;
  replaced_by_id: string | null;
  created_at: number;
}

function toRefreshToken(row: RefreshTokenRow): RefreshToken {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    replacedById: row.replaced_by_id,
    createdAt: row.created_at,
  };
}

export class D1RefreshTokenRepo implements RefreshTokenRepo {
  constructor(private readonly database: D1Database) {}

  async insert(token: RefreshToken): Promise<void> {
    await run(
      this.database
        .prepare(
          `INSERT INTO refresh_tokens
            (id, user_id, token_hash, expires_at, revoked_at, replaced_by_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          token.id,
          token.userId,
          token.tokenHash,
          token.expiresAt,
          token.revokedAt,
          token.replacedById,
          token.createdAt,
        ),
    );
  }

  async findByHash(hash: string): Promise<RefreshToken | null> {
    const row = await one<RefreshTokenRow>(
      this.database
        .prepare("SELECT * FROM refresh_tokens WHERE token_hash = ?")
        .bind(hash),
    );
    return row === null ? null : toRefreshToken(row);
  }

  async findById(id: string): Promise<RefreshToken | null> {
    const row = await one<RefreshTokenRow>(
      this.database
        .prepare("SELECT * FROM refresh_tokens WHERE id = ?")
        .bind(id),
    );
    return row === null ? null : toRefreshToken(row);
  }

  async rotate(
    currentId: string,
    replacement: RefreshToken,
    at: number,
  ): Promise<boolean> {
    const [claimed, inserted] = await batch(this.database, [
      this.database
        .prepare(
          `UPDATE refresh_tokens
           SET revoked_at = ?, replaced_by_id = ?
           WHERE id = ? AND user_id = ? AND revoked_at IS NULL
             AND expires_at > ?`,
        )
        .bind(
          at,
          replacement.id,
          currentId,
          replacement.userId,
          at,
        ),
      this.database
        .prepare(
          `INSERT INTO refresh_tokens
            (id, user_id, token_hash, expires_at, revoked_at, replaced_by_id, created_at)
           SELECT ?, user_id, ?, ?, NULL, NULL, ?
           FROM refresh_tokens
           WHERE id = ? AND user_id = ? AND revoked_at = ?
             AND replaced_by_id = ?
           LIMIT 1`,
        )
        .bind(
          replacement.id,
          replacement.tokenHash,
          replacement.expiresAt,
          replacement.createdAt,
          currentId,
          replacement.userId,
          at,
          replacement.id,
        ),
    ]);
    return claimed?.meta.changes === 1 && inserted?.meta.changes === 1;
  }

  async revoke(
    id: string,
    at: number,
    replacedById?: string,
  ): Promise<void> {
    await run(
      this.database
        .prepare(
          "UPDATE refresh_tokens SET revoked_at = ?, replaced_by_id = ? WHERE id = ?",
        )
        .bind(at, replacedById ?? null, id),
    );
  }

  async revokeAllForUser(userId: string, at: number): Promise<void> {
    await run(
      this.database
        .prepare(
          "UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
        )
        .bind(at, userId),
    );
  }

  async deleteExpired(before: number): Promise<number> {
    const result = await run(
      this.database
        .prepare("DELETE FROM refresh_tokens WHERE expires_at <= ?")
        .bind(before),
    );
    return result.meta.changes;
  }
}
