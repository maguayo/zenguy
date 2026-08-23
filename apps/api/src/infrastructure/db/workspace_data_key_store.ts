import type {
  WorkspaceDataKeyRecord,
  WorkspaceDataKeyStore,
} from "../../shared/crypto";
import { batch, isUniqueConstraintError, one, run } from "./d1";

interface WorkspaceDataKeyRow {
  workspace_id: string;
  data_key_id: string;
  generation: number;
  wrapping_key_id: string;
  wrap_version: number;
  wrapped_key: string;
  active: number;
  created_at: number;
  retired_at: number | null;
}

function toRecord(row: WorkspaceDataKeyRow): WorkspaceDataKeyRecord {
  if (row.wrap_version !== 1 || (row.active !== 0 && row.active !== 1)) {
    throw new Error("Invalid persisted workspace data key metadata");
  }
  return {
    workspaceId: row.workspace_id,
    id: row.data_key_id,
    generation: row.generation,
    wrappingKeyId: row.wrapping_key_id,
    wrapVersion: 1,
    wrappedKey: row.wrapped_key,
    active: row.active === 1,
    createdAt: row.created_at,
    retiredAt: row.retired_at,
  };
}

const SELECT_COLUMNS = `workspace_id, data_key_id, generation,
  wrapping_key_id, wrap_version, wrapped_key, active, created_at, retired_at`;

/**
 * D1 persistence for random per-workspace DEKs. Every lookup includes the
 * workspace id; callers cannot resolve a key by its random id alone.
 */
export class D1WorkspaceDataKeyStore implements WorkspaceDataKeyStore {
  constructor(private readonly database: D1Database) {}

  async findActive(workspaceId: string): Promise<WorkspaceDataKeyRecord | null> {
    const row = await one<WorkspaceDataKeyRow>(
      this.database
        .prepare(
          `SELECT ${SELECT_COLUMNS}
           FROM workspace_data_encryption_keys
           WHERE workspace_id = ? AND active = 1
           LIMIT 1`,
        )
        .bind(workspaceId),
    );
    return row === null ? null : toRecord(row);
  }

  async findById(
    workspaceId: string,
    dataKeyId: string,
  ): Promise<WorkspaceDataKeyRecord | null> {
    const row = await one<WorkspaceDataKeyRow>(
      this.database
        .prepare(
          `SELECT ${SELECT_COLUMNS}
           FROM workspace_data_encryption_keys
           WHERE workspace_id = ? AND data_key_id = ?
           LIMIT 1`,
        )
        .bind(workspaceId, dataKeyId),
    );
    return row === null ? null : toRecord(row);
  }

  async insertActiveIfAbsent(
    candidate: WorkspaceDataKeyRecord,
  ): Promise<WorkspaceDataKeyRecord | null> {
    const results = await batch<WorkspaceDataKeyRow>(this.database, [
      this.database
        .prepare(
          `INSERT OR IGNORE INTO workspace_data_encryption_keys
             (workspace_id, data_key_id, generation, wrapping_key_id,
              wrap_version, wrapped_key, active, created_at, updated_at,
              retired_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, NULL)`,
        )
        .bind(
          candidate.workspaceId,
          candidate.id,
          candidate.generation,
          candidate.wrappingKeyId,
          candidate.wrapVersion,
          candidate.wrappedKey,
          candidate.createdAt,
          candidate.createdAt,
        ),
      this.database
        .prepare(
          `SELECT ${SELECT_COLUMNS}
           FROM workspace_data_encryption_keys
           WHERE workspace_id = ? AND active = 1
           LIMIT 1`,
        )
        .bind(candidate.workspaceId),
    ]);
    const row = results[1]?.results[0];
    return row === undefined ? null : toRecord(row);
  }

  async activate(
    candidate: WorkspaceDataKeyRecord,
    expectedActiveId: string,
    retiredAt: number,
  ): Promise<WorkspaceDataKeyRecord | null> {
    try {
      const results = await batch(this.database, [
        this.database
          .prepare(
            `UPDATE workspace_data_encryption_keys
             SET active = 0, retired_at = ?, updated_at = ?
             WHERE workspace_id = ? AND data_key_id = ? AND active = 1`,
          )
          .bind(
            retiredAt,
            retiredAt,
            candidate.workspaceId,
            expectedActiveId,
          ),
        this.database
          .prepare(
            `INSERT INTO workspace_data_encryption_keys
               (workspace_id, data_key_id, generation, wrapping_key_id,
                wrap_version, wrapped_key, active, created_at, updated_at,
                retired_at)
             SELECT ?, ?, ?, ?, ?, ?, 1, ?, ?, NULL
             WHERE EXISTS (
               SELECT 1 FROM workspace_data_encryption_keys
               WHERE workspace_id = ? AND data_key_id = ?
                 AND active = 0 AND retired_at = ?
             )`,
          )
          .bind(
            candidate.workspaceId,
            candidate.id,
            candidate.generation,
            candidate.wrappingKeyId,
            candidate.wrapVersion,
            candidate.wrappedKey,
            candidate.createdAt,
            candidate.createdAt,
            candidate.workspaceId,
            expectedActiveId,
            retiredAt,
          ),
      ]);
      if (
        results[0]?.meta.changes !== 1 ||
        results[1]?.meta.changes !== 1
      ) {
        return null;
      }
      return this.findById(candidate.workspaceId, candidate.id);
    } catch (error) {
      if (isUniqueConstraintError(error)) return null;
      throw error;
    }
  }

  async replaceWrappedKeyIfUnchanged(input: {
    workspaceId: string;
    dataKeyId: string;
    expectedWrappingKeyId: string;
    expectedWrappedKey: string;
    wrappingKeyId: string;
    wrappedKey: string;
  }): Promise<boolean> {
    const result = await run(
      this.database
        .prepare(
          `UPDATE workspace_data_encryption_keys
           SET wrapping_key_id = ?, wrapped_key = ?,
               updated_at = MAX(updated_at, ?)
           WHERE workspace_id = ? AND data_key_id = ?
             AND wrapping_key_id = ? AND wrapped_key = ?`,
        )
        .bind(
          input.wrappingKeyId,
          input.wrappedKey,
          Date.now(),
          input.workspaceId,
          input.dataKeyId,
          input.expectedWrappingKeyId,
          input.expectedWrappedKey,
        ),
    );
    return result.meta.changes === 1;
  }
}
