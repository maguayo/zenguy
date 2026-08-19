import type { SecretRepo } from "../../domain/secrets/repo";
import type {
  SecretMetaUpdate,
  WorkspaceSecret,
} from "../../domain/secrets/types";
import { all, one, run } from "./d1";

interface SecretRow {
  id: string;
  workspace_id: string;
  key: string;
  encrypted_value: string;
  encryption_version: number;
  allowed_domains: string;
  description: string | null;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

function parseAllowedDomains(encoded: string): string[] {
  const value: unknown = JSON.parse(encoded);
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error("Invalid stored secret domains");
  }
  return value;
}

function toSecret(row: SecretRow): WorkspaceSecret {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    key: row.key,
    encryptedValue: row.encrypted_value,
    encryptionVersion: row.encryption_version,
    allowedDomains: parseAllowedDomains(row.allowed_domains),
    description: row.description,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class D1SecretRepo implements SecretRepo {
  constructor(private readonly database: D1Database) {}

  async insert(secret: WorkspaceSecret): Promise<void> {
    await run(
      this.database
        .prepare(
          `INSERT INTO workspace_secrets
            (id, workspace_id, key, encrypted_value, encryption_version,
             allowed_domains, description, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          secret.id,
          secret.workspaceId,
          secret.key,
          secret.encryptedValue,
          secret.encryptionVersion,
          JSON.stringify(secret.allowedDomains),
          secret.description,
          secret.createdBy,
          secret.createdAt,
          secret.updatedAt,
        ),
    );
  }

  async findByKey(
    workspaceId: string,
    key: string,
  ): Promise<WorkspaceSecret | null> {
    const row = await one<SecretRow>(
      this.database
        .prepare(
          "SELECT * FROM workspace_secrets WHERE workspace_id = ? AND key = ?",
        )
        .bind(workspaceId, key),
    );
    return row === null ? null : toSecret(row);
  }

  async findById(
    workspaceId: string,
    id: string,
  ): Promise<WorkspaceSecret | null> {
    const row = await one<SecretRow>(
      this.database
        .prepare(
          "SELECT * FROM workspace_secrets WHERE workspace_id = ? AND id = ?",
        )
        .bind(workspaceId, id),
    );
    return row === null ? null : toSecret(row);
  }

  async list(workspaceId: string): Promise<WorkspaceSecret[]> {
    const rows = await all<SecretRow>(
      this.database
        .prepare(
          `SELECT * FROM workspace_secrets
           WHERE workspace_id = ?
           ORDER BY created_at DESC, id DESC`,
        )
        .bind(workspaceId),
    );
    return rows.map(toSecret);
  }

  async updateValue(
    id: string,
    encryptedValue: string,
    at: number,
  ): Promise<void> {
    await run(
      this.database
        .prepare(
          `UPDATE workspace_secrets
           SET encrypted_value = ?, updated_at = ?
           WHERE id = ?`,
        )
        .bind(encryptedValue, at, id),
    );
  }

  async updateMeta(
    id: string,
    changes: SecretMetaUpdate,
    at: number,
  ): Promise<void> {
    const hasDomains = changes.allowedDomains !== undefined;
    const hasDescription = changes.description !== undefined;
    await run(
      this.database
        .prepare(
          `UPDATE workspace_secrets
           SET allowed_domains = CASE WHEN ? = 1 THEN ? ELSE allowed_domains END,
               description = CASE WHEN ? = 1 THEN ? ELSE description END,
               updated_at = ?
           WHERE id = ?`,
        )
        .bind(
          hasDomains ? 1 : 0,
          hasDomains ? JSON.stringify(changes.allowedDomains) : null,
          hasDescription ? 1 : 0,
          changes.description ?? null,
          at,
          id,
        ),
    );
  }

  async delete(id: string): Promise<void> {
    await run(
      this.database.prepare("DELETE FROM workspace_secrets WHERE id = ?").bind(id),
    );
  }

  async getManyByKeys(
    workspaceId: string,
    keys: string[],
  ): Promise<WorkspaceSecret[]> {
    if (keys.length === 0) return [];
    const placeholders = keys.map(() => "?").join(", ");
    const rows = await all<SecretRow>(
      this.database
        .prepare(
          `SELECT * FROM workspace_secrets
           WHERE workspace_id = ? AND key IN (${placeholders})
           ORDER BY key ASC`,
        )
        .bind(workspaceId, ...keys),
    );
    return rows.map(toSecret);
  }
}
