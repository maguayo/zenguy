import {
  type RemoteAiConsent,
  type RemoteAiConsentRepo,
  REMOTE_AI_PROVIDER,
} from "../../domain/users/remote_ai_consent";
import { one, run } from "./d1";

interface ConsentRow {
  workspace_id: string;
  provider: typeof REMOTE_AI_PROVIDER;
  policy_version: string;
  accepted_by_user_id: string | null;
  accepted_at: number;
  revoked_by_user_id: string | null;
  revoked_at: number | null;
  updated_at: number;
}

function toConsent(row: ConsentRow): RemoteAiConsent {
  return {
    workspaceId: row.workspace_id,
    provider: row.provider,
    policyVersion: row.policy_version,
    acceptedByUserId: row.accepted_by_user_id,
    acceptedAt: row.accepted_at,
    revokedByUserId: row.revoked_by_user_id,
    revokedAt: row.revoked_at,
    updatedAt: row.updated_at,
  };
}

export class D1RemoteAiConsentRepo implements RemoteAiConsentRepo {
  constructor(private readonly database: D1Database) {}

  async find(workspaceId: string): Promise<RemoteAiConsent | null> {
    const row = await one<ConsentRow>(
      this.database
        .prepare("SELECT * FROM workspace_remote_ai_consents WHERE workspace_id = ?")
        .bind(workspaceId),
    );
    return row === null ? null : toConsent(row);
  }

  async hasActive(
    workspaceId: string,
    provider: typeof REMOTE_AI_PROVIDER,
    policyVersion: string,
  ): Promise<boolean> {
    const row = await one<{ active: number }>(
      this.database
        .prepare(
          `SELECT EXISTS(
             SELECT 1 FROM workspace_remote_ai_consents
             WHERE workspace_id = ? AND provider = ? AND policy_version = ?
               AND revoked_at IS NULL
           ) AS active`,
        )
        .bind(workspaceId, provider, policyVersion),
    );
    return row?.active === 1;
  }

  async grant(input: {
    workspaceId: string;
    provider: typeof REMOTE_AI_PROVIDER;
    policyVersion: string;
    actorUserId: string;
    at: number;
  }): Promise<void> {
    await run(
      this.database
        .prepare(
          `INSERT INTO workspace_remote_ai_consents
             (workspace_id, provider, policy_version, accepted_by_user_id,
              accepted_at, revoked_by_user_id, revoked_at, updated_at)
           VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)
           ON CONFLICT(workspace_id) DO UPDATE SET
             provider = excluded.provider,
             policy_version = excluded.policy_version,
             accepted_by_user_id = excluded.accepted_by_user_id,
             accepted_at = excluded.accepted_at,
             revoked_by_user_id = NULL,
             revoked_at = NULL,
             updated_at = excluded.updated_at`,
        )
        .bind(
          input.workspaceId,
          input.provider,
          input.policyVersion,
          input.actorUserId,
          input.at,
          input.at,
        ),
    );
  }

  async revoke(input: {
    workspaceId: string;
    actorUserId: string;
    at: number;
  }): Promise<boolean> {
    const result = await run(
      this.database
        .prepare(
          `UPDATE workspace_remote_ai_consents
           SET revoked_by_user_id = ?, revoked_at = ?, updated_at = ?
           WHERE workspace_id = ? AND revoked_at IS NULL`,
        )
        .bind(input.actorUserId, input.at, input.at, input.workspaceId),
    );
    return result.meta.changes === 1;
  }
}
