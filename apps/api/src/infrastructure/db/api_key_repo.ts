import type { ApiKeyRepo } from "../../domain/api_keys/repo";
import type { WorkspaceApiKey } from "../../domain/api_keys/types";
import { all, one, run } from "./d1";

interface ApiKeyRow {
  id: string;
  workspace_id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  created_by: string | null;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
}

function toApiKey(row: ApiKeyRow): WorkspaceApiKey {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    keyPrefix: row.key_prefix,
    keyHash: row.key_hash,
    createdBy: row.created_by,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
}

export class D1ApiKeyRepo implements ApiKeyRepo {
  constructor(private readonly database: D1Database) {}

  async insert(apiKey: WorkspaceApiKey): Promise<void> {
    await run(
      this.database
        .prepare(
          `INSERT INTO workspace_api_keys
            (id, workspace_id, name, key_prefix, key_hash,
             created_by, created_at, last_used_at, revoked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          apiKey.id,
          apiKey.workspaceId,
          apiKey.name,
          apiKey.keyPrefix,
          apiKey.keyHash,
          apiKey.createdBy,
          apiKey.createdAt,
          apiKey.lastUsedAt,
          apiKey.revokedAt,
        ),
    );
  }

  async findById(
    workspaceId: string,
    id: string,
  ): Promise<WorkspaceApiKey | null> {
    const row = await one<ApiKeyRow>(
      this.database
        .prepare(
          "SELECT * FROM workspace_api_keys WHERE workspace_id = ? AND id = ?",
        )
        .bind(workspaceId, id),
    );
    return row === null ? null : toApiKey(row);
  }

  async findByHash(keyHash: string): Promise<WorkspaceApiKey | null> {
    const row = await one<ApiKeyRow>(
      this.database
        .prepare("SELECT * FROM workspace_api_keys WHERE key_hash = ?")
        .bind(keyHash),
    );
    return row === null ? null : toApiKey(row);
  }

  async list(workspaceId: string): Promise<WorkspaceApiKey[]> {
    const rows = await all<ApiKeyRow>(
      this.database
        .prepare(
          `SELECT * FROM workspace_api_keys
           WHERE workspace_id = ?
           ORDER BY created_at DESC, id DESC`,
        )
        .bind(workspaceId),
    );
    return rows.map(toApiKey);
  }

  async countActive(workspaceId: string): Promise<number> {
    const row = await one<{ total: number }>(
      this.database
        .prepare(
          `SELECT COUNT(*) AS total FROM workspace_api_keys
           WHERE workspace_id = ? AND revoked_at IS NULL`,
        )
        .bind(workspaceId),
    );
    return row?.total ?? 0;
  }

  async revoke(id: string, at: number): Promise<void> {
    await run(
      this.database
        .prepare(
          `UPDATE workspace_api_keys
           SET revoked_at = ?
           WHERE id = ? AND revoked_at IS NULL`,
        )
        .bind(at, id),
    );
  }

  async touchLastUsed(id: string, at: number): Promise<void> {
    await run(
      this.database
        .prepare("UPDATE workspace_api_keys SET last_used_at = ? WHERE id = ?")
        .bind(at, id),
    );
  }
}
