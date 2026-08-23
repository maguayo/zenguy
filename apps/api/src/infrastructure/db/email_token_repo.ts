import type { EmailTokenRepo } from "../../domain/users/repo";
import type { EmailToken } from "../../domain/users/types";
import { one, run } from "./d1";

interface EmailTokenRow {
  id: string;
  user_id: string;
  type: EmailToken["type"];
  token_hash: string;
  expires_at: number;
  used_at: number | null;
  created_at: number;
}

function toEmailToken(row: EmailTokenRow): EmailToken {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    createdAt: row.created_at,
  };
}

export class D1EmailTokenRepo implements EmailTokenRepo {
  constructor(private readonly database: D1Database) {}

  async insert(token: EmailToken): Promise<void> {
    await run(
      this.database
        .prepare(
          `INSERT INTO email_tokens
            (id, user_id, type, token_hash, expires_at, used_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          token.id,
          token.userId,
          token.type,
          token.tokenHash,
          token.expiresAt,
          token.usedAt,
          token.createdAt,
        ),
    );
  }

  async findValidByHash(
    hash: string,
    type: EmailToken["type"],
    now: number,
  ): Promise<EmailToken | null> {
    const row = await one<EmailTokenRow>(
      this.database
        .prepare(
          `SELECT * FROM email_tokens
           WHERE token_hash = ? AND type = ? AND used_at IS NULL AND expires_at > ?`,
        )
        .bind(hash, type, now),
    );
    return row === null ? null : toEmailToken(row);
  }

  async consumeValidByHash(
    hash: string,
    type: EmailToken["type"],
    now: number,
  ): Promise<EmailToken | null> {
    const row = await one<EmailTokenRow>(
      this.database
        .prepare(
          `UPDATE email_tokens
           SET used_at = ?
           WHERE token_hash = ? AND type = ?
             AND used_at IS NULL AND expires_at > ?
           RETURNING *`,
        )
        .bind(now, hash, type, now),
    );
    return row === null ? null : toEmailToken(row);
  }

  async markUsed(id: string, at: number): Promise<void> {
    await run(
      this.database
        .prepare("UPDATE email_tokens SET used_at = ? WHERE id = ?")
        .bind(at, id),
    );
  }

  async deleteAllForUser(
    userId: string,
    type: EmailToken["type"],
  ): Promise<void> {
    await run(
      this.database
        .prepare("DELETE FROM email_tokens WHERE user_id = ? AND type = ?")
        .bind(userId, type),
    );
  }
}
