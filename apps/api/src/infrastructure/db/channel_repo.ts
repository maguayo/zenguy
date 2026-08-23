import type {
  ChannelRepo,
  ChannelUpdate,
} from "../../domain/channels/repo";
import type {
  ChannelType,
  NotificationChannel,
} from "../../domain/channels/types";
import type { Cursor } from "../../shared/pagination";
import { all, batch, one, run } from "./d1";

interface ChannelRow {
  id: string;
  workspace_id: string;
  name: string;
  type: ChannelType;
  encrypted_config: string;
  enabled: number;
  is_default: number;
  verified_at: number | null;
  last_delivery_status: string | null;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

function toChannel(row: ChannelRow): NotificationChannel {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    type: row.type,
    encryptedConfig: row.encrypted_config,
    enabled: row.enabled === 1,
    isDefault: row.is_default === 1,
    verifiedAt: row.verified_at,
    lastDeliveryStatus: row.last_delivery_status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class D1ChannelRepo implements ChannelRepo {
  constructor(private readonly database: D1Database) {}

  async insert(channel: NotificationChannel): Promise<void> {
    await run(
      this.database
        .prepare(
          `INSERT INTO notification_channels
            (id, workspace_id, name, type, encrypted_config, enabled, is_default,
             verified_at, last_delivery_status, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          channel.id,
          channel.workspaceId,
          channel.name,
          channel.type,
          channel.encryptedConfig,
          channel.enabled ? 1 : 0,
          channel.isDefault === true ? 1 : 0,
          channel.verifiedAt,
          channel.lastDeliveryStatus,
          channel.createdBy,
          channel.createdAt,
          channel.updatedAt,
        ),
    );
  }

  async findById(
    workspaceId: string,
    id: string,
  ): Promise<NotificationChannel | null> {
    const row = await one<ChannelRow>(
      this.database
        .prepare(
          `SELECT * FROM notification_channels
           WHERE workspace_id = ? AND id = ?`,
        )
        .bind(workspaceId, id),
    );
    return row === null ? null : toChannel(row);
  }

  async list(workspaceId: string): Promise<NotificationChannel[]> {
    const rows = await all<ChannelRow>(
      this.database
        .prepare(
          `SELECT * FROM notification_channels
           WHERE workspace_id = ?
           ORDER BY created_at DESC, id DESC`,
        )
        .bind(workspaceId),
    );
    return rows.map(toChannel);
  }

  async listPage(
    workspaceId: string,
    cursor: Cursor | null | undefined,
    limit: number,
  ): Promise<NotificationChannel[]> {
    const values: Array<string | number> = [workspaceId];
    const cursorClause =
      cursor === null || cursor === undefined
        ? ""
        : "AND (created_at < ? OR (created_at = ? AND id < ?))";
    if (cursor !== null && cursor !== undefined) {
      values.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    values.push(limit);
    const rows = await all<ChannelRow>(
      this.database
        .prepare(
          `SELECT * FROM notification_channels
           WHERE workspace_id = ? ${cursorClause}
           ORDER BY created_at DESC, id DESC LIMIT ?`,
        )
        .bind(...values),
    );
    return rows.map(toChannel);
  }

  async listByIds(
    workspaceId: string,
    ids: string[],
  ): Promise<NotificationChannel[]> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(", ");
    const rows = await all<ChannelRow>(
      this.database
        .prepare(
          `SELECT * FROM notification_channels
           WHERE workspace_id = ? AND id IN (${placeholders})
           ORDER BY created_at DESC, id DESC`,
        )
        .bind(workspaceId, ...ids),
    );
    return rows.map(toChannel);
  }

  async update(
    id: string,
    changes: ChannelUpdate,
    at: number,
  ): Promise<void> {
    await run(
      this.database
        .prepare(
          `UPDATE notification_channels
           SET name = CASE WHEN ? = 1 THEN ? ELSE name END,
               enabled = CASE WHEN ? = 1 THEN ? ELSE enabled END,
               is_default = CASE WHEN ? = 1 THEN ? ELSE is_default END,
               encrypted_config = CASE WHEN ? = 1 THEN ? ELSE encrypted_config END,
               updated_at = ?
           WHERE id = ?`,
        )
        .bind(
          changes.name === undefined ? 0 : 1,
          changes.name ?? null,
          changes.enabled === undefined ? 0 : 1,
          changes.enabled === true ? 1 : 0,
          changes.isDefault === undefined ? 0 : 1,
          changes.isDefault === true ? 1 : 0,
          changes.encryptedConfig === undefined ? 0 : 1,
          changes.encryptedConfig ?? null,
          at,
          id,
        ),
    );
  }

  async setLastDeliveryStatus(id: string, status: string): Promise<void> {
    await run(
      this.database
        .prepare(
          "UPDATE notification_channels SET last_delivery_status = ? WHERE id = ?",
        )
        .bind(status, id),
    );
  }

  async setVerified(id: string, at: number): Promise<void> {
    await run(
      this.database
        .prepare(
          `UPDATE notification_channels
           SET verified_at = COALESCE(verified_at, ?) WHERE id = ?`,
        )
        .bind(at, id),
    );
  }

  async delete(id: string): Promise<void> {
    const linkedTables = [
      "browser_test_channels",
      "uptime_monitor_channels",
    ] as const;
    const existingTables = (
      await Promise.all(
        linkedTables.map(async (table) => ({
          table,
          exists:
            (await one<{ name: string }>(
              this.database
                .prepare(
                  "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
                )
                .bind(table),
            )) !== null,
        })),
      )
    ).filter(({ exists }) => exists);
    await batch(this.database, [
      ...existingTables.map(({ table }) =>
        this.database
          .prepare(
            `DELETE FROM ${table} WHERE notification_channel_id = ?`,
          )
          .bind(id),
      ),
      this.database
        .prepare("DELETE FROM notification_channels WHERE id = ?")
        .bind(id),
    ]);
  }
}
