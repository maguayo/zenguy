import type {
  CheckAverageScope,
  CheckInsertResult,
  CheckRepo,
} from "../../domain/uptime/repo";
import type {
  CheckStatus,
  UptimeCheck,
  UptimeSeriesPoint,
} from "../../domain/uptime/types";
import type { Cursor } from "../../shared/pagination";
import { all, isUniqueConstraintError, one, run } from "./d1";

interface CheckRow {
  id: string;
  workspace_id: string;
  uptime_monitor_id: string;
  cycle_id: string;
  attempt_index: number;
  status: CheckStatus;
  http_status: number | null;
  response_time_ms: number | null;
  failure_reason: string | null;
  response_excerpt: string | null;
  checked_at: number;
  created_at: number;
}

function toCheck(row: CheckRow): UptimeCheck {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    uptimeMonitorId: row.uptime_monitor_id,
    cycleId: row.cycle_id,
    attemptIndex: row.attempt_index,
    status: row.status,
    httpStatus: row.http_status,
    responseTimeMs: row.response_time_ms,
    failureReason: row.failure_reason,
    responseExcerpt: row.response_excerpt,
    checkedAt: row.checked_at,
    createdAt: row.created_at,
  };
}

export class D1CheckRepo implements CheckRepo {
  constructor(private readonly database: D1Database) {}

  async insertIfAbsent(check: UptimeCheck): Promise<CheckInsertResult> {
    try {
      await run(
        this.database
          .prepare(
            `INSERT INTO uptime_checks
              (id, workspace_id, uptime_monitor_id, cycle_id, attempt_index,
               status, http_status, response_time_ms, failure_reason,
               response_excerpt, checked_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            check.id,
            check.workspaceId,
            check.uptimeMonitorId,
            check.cycleId,
            check.attemptIndex,
            check.status,
            check.httpStatus,
            check.responseTimeMs,
            check.failureReason,
            check.responseExcerpt,
            check.checkedAt,
            check.createdAt,
          ),
      );
      return "inserted";
    } catch (error) {
      if (isUniqueConstraintError(error)) return "duplicate";
      throw error;
    }
  }

  async listForMonitor(
    monitorId: string,
    cursor: Cursor | null | undefined,
    limit: number,
  ): Promise<UptimeCheck[]> {
    const statement =
      cursor === null || cursor === undefined
        ? this.database
            .prepare(
              `SELECT * FROM uptime_checks
               WHERE uptime_monitor_id = ?
               ORDER BY checked_at DESC, id DESC LIMIT ?`,
            )
            .bind(monitorId, limit)
        : this.database
            .prepare(
              `SELECT * FROM uptime_checks
               WHERE uptime_monitor_id = ?
                 AND (checked_at < ? OR (checked_at = ? AND id < ?))
               ORDER BY checked_at DESC, id DESC LIMIT ?`,
            )
            .bind(
              monitorId,
              cursor.createdAt,
              cursor.createdAt,
              cursor.id,
              limit,
            );
    return (await all<CheckRow>(statement)).map(toCheck);
  }

  async seriesSince(
    monitorId: string,
    fromMs: number,
  ): Promise<UptimeSeriesPoint[]> {
    const rows = await all<
      Pick<CheckRow, "checked_at" | "response_time_ms" | "status">
    >(
      this.database
        .prepare(
          `SELECT checked_at, response_time_ms, status
           FROM uptime_checks
           WHERE uptime_monitor_id = ? AND checked_at >= ?
           ORDER BY checked_at ASC, id ASC`,
        )
        .bind(monitorId, fromMs),
    );
    return rows.map((row) => ({
      checkedAt: row.checked_at,
      responseTimeMs: row.response_time_ms,
      status: row.status,
    }));
  }

  async avgResponseTime(
    scope: CheckAverageScope,
    fromMs: number,
  ): Promise<number | null> {
    const column = "monitorId" in scope ? "uptime_monitor_id" : "workspace_id";
    const value = "monitorId" in scope ? scope.monitorId : scope.workspaceId;
    const row = await one<{ average: number | null }>(
      this.database
        .prepare(
          `SELECT AVG(response_time_ms) AS average FROM uptime_checks
           WHERE ${column} = ? AND checked_at >= ?
             AND response_time_ms IS NOT NULL`,
        )
        .bind(value, fromMs),
    );
    return row?.average ?? null;
  }

  async deleteOlderThan(before: number, limit: number): Promise<number> {
    const result = await run(
      this.database
        .prepare(
          `DELETE FROM uptime_checks WHERE id IN (
             SELECT id FROM uptime_checks WHERE checked_at < ?
             ORDER BY checked_at ASC, id ASC LIMIT ?
           )`,
        )
        .bind(before, limit),
    );
    return result.meta.changes;
  }
}
