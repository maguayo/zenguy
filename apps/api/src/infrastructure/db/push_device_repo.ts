import type { PushDeviceRepo, PushReach } from "../../domain/push/repo";
import type { PushDevice, PushPlatform } from "../../domain/push/types";
import { all, one, run } from "./d1";

interface DeviceRow {
  id: string;
  user_id: string;
  token: string;
  platform: PushPlatform;
  device_name: string | null;
  app_version: string | null;
  enabled: number;
  disabled_reason: string | null;
  last_seen_at: number;
  created_at: number;
  updated_at: number;
}

function toDevice(row: DeviceRow): PushDevice {
  return {
    id: row.id,
    userId: row.user_id,
    token: row.token,
    platform: row.platform,
    deviceName: row.device_name,
    appVersion: row.app_version,
    enabled: row.enabled === 1,
    disabledReason: row.disabled_reason,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class D1PushDeviceRepo implements PushDeviceRepo {
  constructor(private readonly database: D1Database) {}

  async findByToken(token: string): Promise<PushDevice | null> {
    const row = await one<DeviceRow>(
      this.database
        .prepare("SELECT * FROM user_push_devices WHERE token = ?")
        .bind(token),
    );
    return row === null ? null : toDevice(row);
  }

  async findById(userId: string, id: string): Promise<PushDevice | null> {
    const row = await one<DeviceRow>(
      this.database
        .prepare("SELECT * FROM user_push_devices WHERE user_id = ? AND id = ?")
        .bind(userId, id),
    );
    return row === null ? null : toDevice(row);
  }

  async insert(device: PushDevice): Promise<void> {
    await run(
      this.database
        .prepare(
          `INSERT INTO user_push_devices
            (id, user_id, token, platform, device_name, app_version, enabled,
             disabled_reason, last_seen_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          device.id,
          device.userId,
          device.token,
          device.platform,
          device.deviceName,
          device.appVersion,
          device.enabled ? 1 : 0,
          device.disabledReason,
          device.lastSeenAt,
          device.createdAt,
          device.updatedAt,
        ),
    );
  }

  async reassign(
    id: string,
    changes: Pick<
      PushDevice,
      "userId" | "platform" | "deviceName" | "appVersion" | "lastSeenAt"
    >,
    at: number,
  ): Promise<void> {
    await run(
      this.database
        .prepare(
          `UPDATE user_push_devices
           SET user_id = ?, platform = ?, device_name = ?, app_version = ?,
               enabled = 1, disabled_reason = NULL, last_seen_at = ?, updated_at = ?
           WHERE id = ?`,
        )
        .bind(
          changes.userId,
          changes.platform,
          changes.deviceName,
          changes.appVersion,
          changes.lastSeenAt,
          at,
          id,
        ),
    );
  }

  async listForUser(userId: string): Promise<PushDevice[]> {
    const rows = await all<DeviceRow>(
      this.database
        .prepare(
          `SELECT * FROM user_push_devices WHERE user_id = ?
           ORDER BY last_seen_at DESC, id DESC`,
        )
        .bind(userId),
    );
    return rows.map(toDevice);
  }

  async setEnabled(
    id: string,
    enabled: boolean,
    reason: string | null,
    at: number,
  ): Promise<void> {
    await run(
      this.database
        .prepare(
          `UPDATE user_push_devices
           SET enabled = ?, disabled_reason = ?, updated_at = ? WHERE id = ?`,
        )
        .bind(enabled ? 1 : 0, enabled ? null : reason, at, id),
    );
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const result = await run(
      this.database
        .prepare("DELETE FROM user_push_devices WHERE user_id = ? AND id = ?")
        .bind(userId, id),
    );
    return (result.meta.changes ?? 0) > 0;
  }

  async listEnabledTokensForWorkspace(
    workspaceId: string,
    activeSince: number,
  ): Promise<{ token: string; userId: string }[]> {
    const rows = await all<{ token: string; user_id: string }>(
      this.database
        .prepare(
          `SELECT d.token, d.user_id
           FROM user_push_devices d
           JOIN workspace_members m ON m.user_id = d.user_id
           WHERE m.workspace_id = ? AND d.enabled = 1
             AND d.last_seen_at >= ?
           ORDER BY d.created_at ASC, d.id ASC`,
        )
        .bind(workspaceId, activeSince),
    );
    return rows.map((row) => ({ token: row.token, userId: row.user_id }));
  }

  async reachForWorkspace(workspaceId: string): Promise<PushReach> {
    const row = await one<{ devices: number; members: number }>(
      this.database
        .prepare(
          `SELECT COUNT(d.id) AS devices, COUNT(DISTINCT d.user_id) AS members
           FROM user_push_devices d
           JOIN workspace_members m ON m.user_id = d.user_id
           WHERE m.workspace_id = ? AND d.enabled = 1`,
        )
        .bind(workspaceId),
    );
    return { devices: row?.devices ?? 0, members: row?.members ?? 0 };
  }

  async disableTokens(
    tokens: string[],
    reason: string,
    at: number,
  ): Promise<void> {
    if (tokens.length === 0) return;
    const placeholders = tokens.map(() => "?").join(", ");
    await run(
      this.database
        .prepare(
          `UPDATE user_push_devices
           SET enabled = 0, disabled_reason = ?, updated_at = ?
           WHERE token IN (${placeholders})`,
        )
        .bind(reason, at, ...tokens),
    );
  }

}
