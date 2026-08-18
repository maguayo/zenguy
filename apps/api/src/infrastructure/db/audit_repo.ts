import type { AuditAction } from "../../domain/audit/actions";
import type { AuditRepo } from "../../domain/audit/repo";
import type { AuditEntry } from "../../domain/audit/types";
import type { Cursor } from "../../shared/pagination";
import { all, run } from "./d1";

interface AuditRow {
  id: string;
  workspace_id: string;
  actor_user_id: string | null;
  action: AuditAction;
  resource_type: string | null;
  resource_id: string | null;
  metadata_json: string | null;
  ip: string | null;
  created_at: number;
}

function toAuditEntry(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    actorUserId: row.actor_user_id,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    metadataJson: row.metadata_json,
    ip: row.ip,
    createdAt: row.created_at,
  };
}

export class D1AuditRepo implements AuditRepo {
  constructor(private readonly database: D1Database) {}

  async insert(entry: AuditEntry): Promise<void> {
    await run(
      this.database
        .prepare(
          `INSERT INTO audit_logs
            (id, workspace_id, actor_user_id, action, resource_type, resource_id, metadata_json, ip, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          entry.id,
          entry.workspaceId,
          entry.actorUserId,
          entry.action,
          entry.resourceType,
          entry.resourceId,
          entry.metadataJson,
          entry.ip,
          entry.createdAt,
        ),
    );
  }

  async list(
    workspaceId: string,
    cursor: Cursor | null | undefined,
    limit: number,
  ): Promise<AuditEntry[]> {
    const statement =
      cursor === null || cursor === undefined
        ? this.database
            .prepare(
              `SELECT * FROM audit_logs
               WHERE workspace_id = ?
               ORDER BY created_at DESC, id DESC LIMIT ?`,
            )
            .bind(workspaceId, limit)
        : this.database
            .prepare(
              `SELECT * FROM audit_logs
               WHERE workspace_id = ?
                 AND (created_at < ? OR (created_at = ? AND id < ?))
               ORDER BY created_at DESC, id DESC LIMIT ?`,
            )
            .bind(
              workspaceId,
              cursor.createdAt,
              cursor.createdAt,
              cursor.id,
              limit,
            );
    return (await all<AuditRow>(statement)).map(toAuditEntry);
  }
}
