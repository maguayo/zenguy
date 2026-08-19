import type { SubscriptionGrantRepo } from "../../domain/billing/repo";
import type { SubscriptionGrant } from "../../domain/billing/types";
import { all, one, run } from "./d1";

interface GrantRow {
  id: string;
  token_hash: string;
  issued_by_user_id: string;
  note: string | null;
  expires_at: number;
  redeemed_at: number | null;
  redeemed_workspace_id: string | null;
  created_at: number;
}

function toGrant(row: GrantRow): SubscriptionGrant {
  return {
    id: row.id,
    tokenHash: row.token_hash,
    issuedByUserId: row.issued_by_user_id,
    note: row.note,
    expiresAt: row.expires_at,
    redeemedAt: row.redeemed_at,
    redeemedWorkspaceId: row.redeemed_workspace_id,
    createdAt: row.created_at,
  };
}

export class D1SubscriptionGrantRepo implements SubscriptionGrantRepo {
  constructor(private readonly database: D1Database) {}

  async insert(grant: SubscriptionGrant): Promise<void> {
    await run(
      this.database
        .prepare(
          `INSERT INTO subscription_grants
            (id, token_hash, issued_by_user_id, note, expires_at,
             redeemed_at, redeemed_workspace_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          grant.id,
          grant.tokenHash,
          grant.issuedByUserId,
          grant.note,
          grant.expiresAt,
          grant.redeemedAt,
          grant.redeemedWorkspaceId,
          grant.createdAt,
        ),
    );
  }

  async findByHash(hash: string): Promise<SubscriptionGrant | null> {
    const row = await one<GrantRow>(
      this.database
        .prepare("SELECT * FROM subscription_grants WHERE token_hash = ?")
        .bind(hash),
    );
    return row === null ? null : toGrant(row);
  }

  async findValidByHash(
    hash: string,
    now: number,
  ): Promise<SubscriptionGrant | null> {
    const row = await one<GrantRow>(
      this.database
        .prepare(
          `SELECT * FROM subscription_grants
           WHERE token_hash = ? AND redeemed_at IS NULL AND expires_at > ?`,
        )
        .bind(hash, now),
    );
    return row === null ? null : toGrant(row);
  }

  async listByIssuer(userId: string): Promise<SubscriptionGrant[]> {
    const rows = await all<GrantRow>(
      this.database
        .prepare(
          `SELECT * FROM subscription_grants
           WHERE issued_by_user_id = ?
           ORDER BY created_at DESC, id DESC`,
        )
        .bind(userId),
    );
    return rows.map(toGrant);
  }

  async consume(
    id: string,
    workspaceId: string,
    at: number,
  ): Promise<boolean> {
    const result = await run(
      this.database
        .prepare(
          `UPDATE subscription_grants
           SET redeemed_at = ?, redeemed_workspace_id = ?
           WHERE id = ? AND redeemed_at IS NULL AND expires_at > ?`,
        )
        .bind(at, workspaceId, id, at),
    );
    return (result.meta.changes ?? 0) > 0;
  }
}
