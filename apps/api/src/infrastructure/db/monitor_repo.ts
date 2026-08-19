import type {
  CloseMonitorCycle,
  MonitorRepo,
  MonitorUpdate,
} from "../../domain/uptime/repo";
import type {
  BodyCondition,
  ClaimedUptimeMonitor,
  MonitorMethod,
  MonitorStatus,
  MonitorStatusCounts,
  UptimeMonitor,
} from "../../domain/uptime/types";
import { all, batch, one, run } from "./d1";

interface MonitorRow {
  id: string;
  workspace_id: string;
  name: string;
  url: string;
  method: MonitorMethod;
  encrypted_headers: string | null;
  encrypted_body: string | null;
  expected_status: number;
  body_condition: BodyCondition | null;
  body_expected_value: string | null;
  body_condition_path: string | null;
  frequency_seconds: number;
  timeout_seconds: number;
  max_retries: number;
  notify_on_recovery: number;
  next_check_at: number;
  current_status: MonitorStatus;
  current_cycle_id: string | null;
  cycle_started_at: number | null;
  last_check_at: number | null;
  last_response_time_ms: number | null;
  created_by: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

function toMonitor(row: MonitorRow): UptimeMonitor {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    url: row.url,
    method: row.method,
    encryptedHeaders: row.encrypted_headers,
    encryptedBody: row.encrypted_body,
    expectedStatus: row.expected_status,
    bodyCondition: row.body_condition,
    bodyExpectedValue: row.body_expected_value,
    bodyConditionPath: row.body_condition_path,
    frequencySeconds: row.frequency_seconds,
    timeoutSeconds: row.timeout_seconds,
    maxRetries: row.max_retries,
    notifyOnRecovery: row.notify_on_recovery === 1,
    nextCheckAt: row.next_check_at,
    currentStatus: row.current_status,
    currentCycleId: row.current_cycle_id,
    cycleStartedAt: row.cycle_started_at,
    lastCheckAt: row.last_check_at,
    lastResponseTimeMs: row.last_response_time_ms,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export class D1MonitorRepo implements MonitorRepo {
  constructor(private readonly database: D1Database) {}

  async insert(monitor: UptimeMonitor): Promise<void> {
    await run(
      this.database
        .prepare(
          `INSERT INTO uptime_monitors
            (id, workspace_id, name, url, method, encrypted_headers,
             encrypted_body, expected_status, body_condition,
             body_expected_value, body_condition_path, frequency_seconds,
             timeout_seconds, max_retries, notify_on_recovery, next_check_at,
             current_status, current_cycle_id, cycle_started_at, last_check_at,
             last_response_time_ms, created_by, created_at, updated_at,
             deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          monitor.id,
          monitor.workspaceId,
          monitor.name,
          monitor.url,
          monitor.method,
          monitor.encryptedHeaders,
          monitor.encryptedBody,
          monitor.expectedStatus,
          monitor.bodyCondition,
          monitor.bodyExpectedValue,
          monitor.bodyConditionPath,
          monitor.frequencySeconds,
          monitor.timeoutSeconds,
          monitor.maxRetries,
          monitor.notifyOnRecovery ? 1 : 0,
          monitor.nextCheckAt,
          monitor.currentStatus,
          monitor.currentCycleId,
          monitor.cycleStartedAt,
          monitor.lastCheckAt,
          monitor.lastResponseTimeMs,
          monitor.createdBy,
          monitor.createdAt,
          monitor.updatedAt,
          monitor.deletedAt,
        ),
    );
  }

  async findById(
    workspaceId: string,
    id: string,
  ): Promise<UptimeMonitor | null> {
    const row = await one<MonitorRow>(
      this.database
        .prepare(
          `SELECT * FROM uptime_monitors
           WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL`,
        )
        .bind(workspaceId, id),
    );
    return row === null ? null : toMonitor(row);
  }

  async list(workspaceId: string): Promise<UptimeMonitor[]> {
    const rows = await all<MonitorRow>(
      this.database
        .prepare(
          `SELECT * FROM uptime_monitors
           WHERE workspace_id = ? AND deleted_at IS NULL
           ORDER BY created_at DESC, id DESC`,
        )
        .bind(workspaceId),
    );
    return rows.map(toMonitor);
  }

  async update(
    id: string,
    changes: MonitorUpdate,
    at: number,
  ): Promise<void> {
    const assignments: string[] = [];
    const values: unknown[] = [];
    const add = (column: string, value: unknown): void => {
      assignments.push(`${column} = ?`);
      values.push(value);
    };
    if (changes.name !== undefined) add("name", changes.name);
    if (changes.url !== undefined) add("url", changes.url);
    if (changes.method !== undefined) add("method", changes.method);
    if (changes.encryptedHeaders !== undefined) {
      add("encrypted_headers", changes.encryptedHeaders);
    }
    if (changes.encryptedBody !== undefined) {
      add("encrypted_body", changes.encryptedBody);
    }
    if (changes.expectedStatus !== undefined) {
      add("expected_status", changes.expectedStatus);
    }
    if (changes.bodyCondition !== undefined) {
      add("body_condition", changes.bodyCondition);
    }
    if (changes.bodyExpectedValue !== undefined) {
      add("body_expected_value", changes.bodyExpectedValue);
    }
    if (changes.bodyConditionPath !== undefined) {
      add("body_condition_path", changes.bodyConditionPath);
    }
    if (changes.frequencySeconds !== undefined) {
      add("frequency_seconds", changes.frequencySeconds);
    }
    if (changes.timeoutSeconds !== undefined) {
      add("timeout_seconds", changes.timeoutSeconds);
    }
    if (changes.maxRetries !== undefined) {
      add("max_retries", changes.maxRetries);
    }
    if (changes.notifyOnRecovery !== undefined) {
      add("notify_on_recovery", changes.notifyOnRecovery ? 1 : 0);
    }
    if (changes.nextCheckAt !== undefined) {
      add("next_check_at", changes.nextCheckAt);
    }
    add("updated_at", at);
    await run(
      this.database
        .prepare(
          `UPDATE uptime_monitors SET ${assignments.join(", ")}
           WHERE id = ? AND deleted_at IS NULL`,
        )
        .bind(...values, id),
    );
  }

  async softDelete(id: string, at: number): Promise<void> {
    await run(
      this.database
        .prepare(
          `UPDATE uptime_monitors
           SET deleted_at = ?, updated_at = ?, current_cycle_id = NULL,
               cycle_started_at = NULL
           WHERE id = ? AND deleted_at IS NULL`,
        )
        .bind(at, at, id),
    );
  }

  async claimDue(
    now: number,
    limit: number,
  ): Promise<ClaimedUptimeMonitor[]> {
    const due = await all<MonitorRow>(
      this.database
        .prepare(
          `SELECT * FROM uptime_monitors
           WHERE deleted_at IS NULL AND current_cycle_id IS NULL
             AND next_check_at <= ?
           ORDER BY next_check_at ASC, id ASC LIMIT ?`,
        )
        .bind(now, limit),
    );
    const claimed = await Promise.all(
      due.map(async (row): Promise<ClaimedUptimeMonitor | null> => {
        const nextCheckAt = now + row.frequency_seconds * 1_000;
        const result = await run(
          this.database
            .prepare(
              `UPDATE uptime_monitors SET next_check_at = ?
               WHERE id = ? AND next_check_at = ? AND deleted_at IS NULL
                 AND current_cycle_id IS NULL`,
            )
            .bind(nextCheckAt, row.id, row.next_check_at),
        );
        if (result.meta.changes !== 1) return null;
        return {
          ...toMonitor(row),
          nextCheckAt,
          scheduledFor: row.next_check_at,
        };
      }),
    );
    return claimed.filter(
      (monitor): monitor is ClaimedUptimeMonitor => monitor !== null,
    );
  }

  async openCycle(id: string, cycleId: string, at: number): Promise<boolean> {
    const result = await run(
      this.database
        .prepare(
          `UPDATE uptime_monitors
           SET current_cycle_id = ?, cycle_started_at = ?, updated_at = ?
           WHERE id = ? AND current_cycle_id IS NULL AND deleted_at IS NULL`,
        )
        .bind(cycleId, at, at, id),
    );
    return result.meta.changes === 1;
  }

  async closeCycle(
    id: string,
    changes: CloseMonitorCycle,
    expectedCycleId: string,
  ): Promise<boolean> {
    const result = await run(
      this.database
        .prepare(
          `UPDATE uptime_monitors
           SET current_status = ?, current_cycle_id = NULL,
               cycle_started_at = NULL, last_check_at = ?,
               last_response_time_ms = ?, updated_at = ?
           WHERE id = ? AND deleted_at IS NULL AND current_cycle_id = ?`,
        )
        .bind(
          changes.status,
          changes.lastCheckAt,
          changes.lastResponseTimeMs,
          changes.lastCheckAt,
          id,
          expectedCycleId,
        ),
    );
    return result.meta.changes === 1;
  }

  async listZombieCycles(before: number): Promise<UptimeMonitor[]> {
    const rows = await all<MonitorRow>(
      this.database
        .prepare(
          `SELECT * FROM uptime_monitors
           WHERE current_cycle_id IS NOT NULL AND cycle_started_at < ?
           ORDER BY cycle_started_at ASC, id ASC`,
        )
        .bind(before),
    );
    return rows.map(toMonitor);
  }

  async clearCycle(id: string, expectedCycleId: string): Promise<boolean> {
    const result = await run(
      this.database
        .prepare(
          `UPDATE uptime_monitors
           SET current_cycle_id = NULL, cycle_started_at = NULL
           WHERE id = ? AND current_cycle_id = ?`,
        )
        .bind(id, expectedCycleId),
    );
    return result.meta.changes === 1;
  }

  async setChannels(monitorId: string, channelIds: string[]): Promise<void> {
    const uniqueIds = [...new Set(channelIds)];
    await batch(this.database, [
      this.database
        .prepare(
          "DELETE FROM uptime_monitor_channels WHERE uptime_monitor_id = ?",
        )
        .bind(monitorId),
      ...uniqueIds.map((channelId) =>
        this.database
          .prepare(
            `INSERT INTO uptime_monitor_channels
              (uptime_monitor_id, notification_channel_id) VALUES (?, ?)`,
          )
          .bind(monitorId, channelId),
      ),
    ]);
  }

  async getChannelIds(monitorId: string): Promise<string[]> {
    const rows = await all<{ notification_channel_id: string }>(
      this.database
        .prepare(
          `SELECT notification_channel_id FROM uptime_monitor_channels
           WHERE uptime_monitor_id = ?
           ORDER BY notification_channel_id ASC`,
        )
        .bind(monitorId),
    );
    return rows.map((row) => row.notification_channel_id);
  }

  async statusCounts(workspaceId: string): Promise<MonitorStatusCounts> {
    const row = await one<{
      up: number;
      down: number;
      unknown: number;
    }>(
      this.database
        .prepare(
          `SELECT
             SUM(CASE WHEN current_status = 'UP' THEN 1 ELSE 0 END) AS up,
             SUM(CASE WHEN current_status = 'DOWN' THEN 1 ELSE 0 END) AS down,
             SUM(CASE WHEN current_status = 'UNKNOWN' THEN 1 ELSE 0 END) AS unknown
           FROM uptime_monitors
           WHERE workspace_id = ? AND deleted_at IS NULL`,
        )
        .bind(workspaceId),
    );
    return {
      up: row?.up ?? 0,
      down: row?.down ?? 0,
      unknown: row?.unknown ?? 0,
    };
  }
}
