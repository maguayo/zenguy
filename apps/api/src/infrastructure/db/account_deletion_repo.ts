import type { AccountDeletionRepo } from "../../domain/users/account_deletion";
import { sha256Hex } from "../../shared/crypto";
import { batch } from "./d1";

/**
 * Personal-data erasure that deliberately leaves a stable, anonymized user
 * tombstone for retained financial/security records. Workspace-owned data is
 * handled separately by WorkspaceDeletionSaga before this transaction runs.
 */
export class D1AccountDeletionRepo implements AccountDeletionRepo {
  constructor(private readonly database: D1Database) {}

  async finalize(input: {
    userId: string;
    email: string;
    at: number;
  }): Promise<void> {
    const redactedEmail = `deleted+${input.userId}@redacted.invalid`;
    const userDigest = await sha256Hex(input.userId);
    const emailDigest = await sha256Hex(input.email.trim().toLowerCase());
    await batch(this.database, [
      this.database
        .prepare(
          `UPDATE refresh_tokens
           SET revoked_at = COALESCE(revoked_at, ?),
               token_hash = lower(hex(randomblob(32)))
           WHERE user_id = ?`,
        )
        .bind(input.at, input.userId),
      this.database
        .prepare(
          `UPDATE admin_sessions
           SET revoked_at = COALESCE(revoked_at, ?), email = ?
           WHERE user_id = ?`,
        )
        .bind(input.at, redactedEmail, input.userId),
      this.database
        .prepare("DELETE FROM email_tokens WHERE user_id = ?")
        .bind(input.userId),
      this.database
        .prepare("DELETE FROM oauth_identities WHERE user_id = ?")
        .bind(input.userId),
      this.database
        .prepare("DELETE FROM user_legal_acceptances WHERE user_id = ?")
        .bind(input.userId),
      this.database
        .prepare("DELETE FROM user_push_devices WHERE user_id = ?")
        .bind(input.userId),
      this.database
        .prepare(
          `UPDATE activity_events
           SET user_id = NULL, resource_id = NULL, properties_json = NULL
           WHERE user_id = ?`,
        )
        .bind(input.userId),
      this.database
        .prepare(
          `UPDATE audit_logs
           SET actor_user_id = NULL,
               metadata_json = '{"retainedFor":"security_and_legal"}',
               ip = NULL
           WHERE actor_user_id = ?`,
        )
        .bind(input.userId),
      this.database
        .prepare(
          `UPDATE audit_logs
           SET resource_id = NULL,
               metadata_json = '{"retainedFor":"security_and_legal"}'
           WHERE resource_id = ?
              OR (json_valid(metadata_json) AND (
                json_extract(metadata_json, '$.targetUserId') = ? OR
                json_extract(metadata_json, '$.oldOwnerUserId') = ? OR
                json_extract(metadata_json, '$.newOwnerUserId') = ?
              ))`,
        )
        .bind(input.userId, input.userId, input.userId, input.userId),
      this.database
        .prepare("UPDATE workspace_members SET invited_by = NULL WHERE invited_by = ?")
        .bind(input.userId),
      this.database
        .prepare(
          `UPDATE workspace_invitations
           SET invited_by = 'deleted-user',
               token_hash = CASE
                 WHEN accepted_at IS NULL THEN lower(hex(randomblob(32)))
                 ELSE token_hash
               END,
               revoked_at = CASE
                 WHEN accepted_at IS NULL THEN COALESCE(revoked_at, ?)
                 ELSE revoked_at
               END
           WHERE invited_by = ?`,
        )
        .bind(input.at, input.userId),
      this.database
        .prepare(
          `UPDATE workspace_invitations
           SET email = ?,
               token_hash = lower(hex(randomblob(32))),
               revoked_at = CASE
                 WHEN accepted_at IS NULL THEN COALESCE(revoked_at, ?)
                 ELSE revoked_at
               END
           WHERE email = ? COLLATE NOCASE`,
        )
        .bind(redactedEmail, input.at, input.email),
      this.database
        .prepare(
          `UPDATE workspace_api_keys
           SET revoked_at = COALESCE(revoked_at, ?), created_by = NULL
           WHERE created_by = ?`,
        )
        .bind(input.at, input.userId),
      this.database
        .prepare(
          `UPDATE notification_channels
           SET enabled = 0, created_by = NULL, updated_at = ?
           WHERE created_by = ?`,
        )
        .bind(input.at, input.userId),
      this.database
        .prepare("UPDATE workspace_secrets SET created_by = NULL WHERE created_by = ?")
        .bind(input.userId),
      this.database
        .prepare(
          `UPDATE browser_tests
           SET created_by = CASE WHEN created_by = ? THEN NULL ELSE created_by END,
               updated_by = CASE WHEN updated_by = ? THEN NULL ELSE updated_by END
           WHERE created_by = ? OR updated_by = ?`,
        )
        .bind(input.userId, input.userId, input.userId, input.userId),
      this.database
        .prepare(
          `UPDATE test_runs
           SET triggered_by_user_id = NULL,
               snapshot_json = CASE
                 WHEN json_valid(snapshot_json)
                   THEN json_remove(snapshot_json, '$.irreversibleAuthorization')
                 ELSE snapshot_json
               END
           WHERE triggered_by_user_id = ?`,
        )
        .bind(input.userId),
      this.database
        .prepare("UPDATE uptime_monitors SET created_by = NULL WHERE created_by = ?")
        .bind(input.userId),
      this.database
        .prepare("UPDATE status_pages SET created_by = NULL WHERE created_by = ?")
        .bind(input.userId),
      this.database
        .prepare("UPDATE incident_updates SET created_by = NULL WHERE created_by = ?")
        .bind(input.userId),
      this.database
        .prepare(
          `UPDATE workspace_remote_ai_consents
           SET accepted_by_user_id = CASE
                 WHEN accepted_by_user_id = ? THEN NULL
                 ELSE accepted_by_user_id
               END,
               revoked_by_user_id = CASE
                 WHEN revoked_by_user_id = ? THEN NULL
                 ELSE revoked_by_user_id
               END
           WHERE accepted_by_user_id = ? OR revoked_by_user_id = ?`,
        )
        .bind(input.userId, input.userId, input.userId, input.userId),
      this.database
        .prepare("DELETE FROM paddle_checkout_intents WHERE actor_user_id = ?")
        .bind(input.userId),
      this.database
        .prepare("DELETE FROM stripe_checkout_intents WHERE actor_user_id = ?")
        .bind(input.userId),
      this.database
        .prepare(
          `UPDATE subscription_grants
           SET issued_by_user_id = 'deleted-user',
               token_hash = lower(hex(randomblob(32))),
               note = CASE WHEN note IS NULL THEN NULL ELSE 'Retained grant record' END,
               expires_at = CASE WHEN expires_at > ? THEN ? ELSE expires_at END
           WHERE issued_by_user_id = ?`,
        )
        .bind(input.at, input.at, input.userId),
      this.database
        .prepare(
          `DELETE FROM run_quota_counters
           WHERE scope_kind IN ('USER', 'OWNER') AND scope_id = ?`,
        )
        .bind(input.userId),
      this.database
        .prepare(
          `DELETE FROM rate_limit_windows
           WHERE instr(rate_key, ?) > 0
              OR instr(rate_key, ?) > 0
              OR instr(rate_key, ?) > 0`,
        )
        .bind(input.userId, userDigest, emailDigest),
      this.database
        .prepare(
          "DELETE FROM workspace_members WHERE user_id = ? AND role != 'OWNER'",
        )
        .bind(input.userId),
      this.database
        .prepare(
          `UPDATE users
           SET name = 'Deleted user', email = ?,
               password_hash = lower(hex(randomblob(32))),
               email_verified_at = NULL,
               auth_version = auth_version + 1,
               deleted_at = ?, updated_at = ?
           WHERE id = ? AND deleted_at IS NULL`,
        )
        .bind(redactedEmail, input.at, input.at, input.userId),
    ]);
  }
}
