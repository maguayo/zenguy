import type {
  EncryptedRecord,
  EncryptionReplacement,
  EncryptionRotationRepo,
} from "../../domain/security/encryption";
import { isStaleDataEncryptionKeyError } from "../../domain/security/encryption";
import {
  CURRENT_ENCRYPTION_VERSION,
  type EncryptedRecordType,
} from "../../shared/crypto";
import { all, batch } from "./d1";

interface EncryptedRecordRow {
  type: EncryptedRecordType;
  workspace_id: string;
  record_id: string;
  ciphertext: string;
}

function toRecord(row: EncryptedRecordRow): EncryptedRecord {
  return {
    type: row.type,
    workspaceId: row.workspace_id,
    recordId: row.record_id,
    ciphertext: row.ciphertext,
  };
}

export class D1EncryptionRotationRepo implements EncryptionRotationRepo {
  constructor(private readonly database: D1Database) {}

  async listPending(
    workspaceId: string,
    activeDataKeyId: string,
    limit: number,
  ): Promise<EncryptedRecord[]> {
    const activePrefix = `v${CURRENT_ENCRYPTION_VERSION}:${activeDataKeyId}:`;
    const rows = await all<EncryptedRecordRow>(
      this.database
        .prepare(
          `SELECT type, workspace_id, record_id, ciphertext
           FROM (
             SELECT 'workspace_secret' AS type, workspace_id,
                    id AS record_id, encrypted_value AS ciphertext
             FROM workspace_secrets
             WHERE workspace_id = ?
               AND substr(encrypted_value, 1, ?) <> ?
             UNION ALL
             SELECT 'notification_channel' AS type, workspace_id,
                    id AS record_id, encrypted_config AS ciphertext
             FROM notification_channels
             WHERE workspace_id = ?
               AND substr(encrypted_config, 1, ?) <> ?
             UNION ALL
             SELECT 'uptime_monitor_headers' AS type, workspace_id,
                    id AS record_id, encrypted_headers AS ciphertext
             FROM uptime_monitors
             WHERE workspace_id = ? AND encrypted_headers IS NOT NULL
               AND substr(encrypted_headers, 1, ?) <> ?
             UNION ALL
             SELECT 'uptime_monitor_body' AS type, workspace_id,
                    id AS record_id, encrypted_body AS ciphertext
             FROM uptime_monitors
             WHERE workspace_id = ? AND encrypted_body IS NOT NULL
               AND substr(encrypted_body, 1, ?) <> ?
           )
           ORDER BY type ASC, record_id ASC
           LIMIT ?`,
        )
        .bind(
          workspaceId,
          activePrefix.length,
          activePrefix,
          workspaceId,
          activePrefix.length,
          activePrefix,
          workspaceId,
          activePrefix.length,
          activePrefix,
          workspaceId,
          activePrefix.length,
          activePrefix,
          limit,
        ),
    );
    return rows.map(toRecord);
  }

  async replaceIfUnchanged(
    replacements: readonly EncryptionReplacement[],
    at: number,
  ): Promise<boolean[]> {
    if (replacements.length === 0) return [];
    const statements = replacements.map((item) => {
      switch (item.type) {
        case "workspace_secret":
          return this.database
            .prepare(
              `UPDATE workspace_secrets
               SET encrypted_value = ?, encryption_version = ${CURRENT_ENCRYPTION_VERSION}, updated_at = ?
               WHERE workspace_id = ? AND id = ? AND encrypted_value = ?`,
            )
            .bind(
              item.replacement,
              at,
              item.workspaceId,
              item.recordId,
              item.ciphertext,
            );
        case "notification_channel":
          return this.database
            .prepare(
              `UPDATE notification_channels
               SET encrypted_config = ?, updated_at = ?
               WHERE workspace_id = ? AND id = ? AND encrypted_config = ?`,
            )
            .bind(
              item.replacement,
              at,
              item.workspaceId,
              item.recordId,
              item.ciphertext,
            );
        case "uptime_monitor_headers":
          return this.database
            .prepare(
              `UPDATE uptime_monitors
               SET encrypted_headers = ?, updated_at = ?
               WHERE workspace_id = ? AND id = ? AND encrypted_headers = ?`,
            )
            .bind(
              item.replacement,
              at,
              item.workspaceId,
              item.recordId,
              item.ciphertext,
            );
        case "uptime_monitor_body":
          return this.database
            .prepare(
              `UPDATE uptime_monitors
               SET encrypted_body = ?, updated_at = ?
               WHERE workspace_id = ? AND id = ? AND encrypted_body = ?`,
            )
            .bind(
              item.replacement,
              at,
              item.workspaceId,
              item.recordId,
              item.ciphertext,
            );
      }
    });
    try {
      const results = await batch(this.database, statements);
      return results.map((result) => result.meta.changes === 1);
    } catch (error) {
      if (!isStaleDataEncryptionKeyError(error)) throw error;
      // D1 batches are transactional. A concurrent DEK rotation invalidates
      // every replacement produced by this batch; report CAS conflicts so the
      // caller's final sweep keeps hasMore true and retries under the winner.
      return replacements.map(() => false);
    }
  }
}
