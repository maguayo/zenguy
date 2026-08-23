import type { ApiKeyRepo } from "../../domain/api_keys/repo";
import {
  API_KEY_SCOPES,
  type ApiKeyScope,
  type WorkspaceApiKey,
} from "../../domain/api_keys/types";
import { all, one, run } from "./d1";

interface ApiKeyRow {
  id: string;
  workspace_id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  scopes_json: string;
  expires_at: number;
  created_by: string | null;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
}

function parseScopes(value: string): ApiKeyScope[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const allowed = new Set<string>(API_KEY_SCOPES);
    if (!parsed.every((scope) => typeof scope === "string" && allowed.has(scope))) {
      return [];
    }
    return [...new Set(parsed)] as ApiKeyScope[];
  } catch {
    return [];
  }
}

function toApiKey(row: ApiKeyRow): WorkspaceApiKey {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    keyPrefix: row.key_prefix,
    keyHash: row.key_hash,
    scopes: parseScopes(row.scopes_json),
    expiresAt: row.expires_at,
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
             scopes_json, expires_at, created_by, created_at, last_used_at, revoked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          apiKey.id,
          apiKey.workspaceId,
          apiKey.name,
          apiKey.keyPrefix,
          apiKey.keyHash,
          JSON.stringify(apiKey.scopes),
          apiKey.expiresAt,
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

  async countActive(workspaceId: string, now: number): Promise<number> {
    const row = await one<{ total: number }>(
      this.database
        .prepare(
          `SELECT COUNT(*) AS total FROM workspace_api_keys
           WHERE workspace_id = ? AND revoked_at IS NULL AND expires_at > ?`,
        )
        .bind(workspaceId, now),
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

  async revokeAllCreatedBy(
    workspaceId: string,
    creatorUserId: string,
    at: number,
  ): Promise<number> {
    const result = await run(
      this.database
        .prepare(
          `UPDATE workspace_api_keys SET revoked_at = ?
           WHERE workspace_id = ? AND created_by = ? AND revoked_at IS NULL`,
        )
        .bind(at, workspaceId, creatorUserId),
    );
    return result.meta.changes;
  }

  async touchLastUsed(id: string, at: number): Promise<void> {
    await run(
      this.database
        .prepare("UPDATE workspace_api_keys SET last_used_at = ? WHERE id = ?")
        .bind(at, id),
    );
  }
}
