import type { IncidentRepo } from "../../domain/incidents/repo";
import type {
  Incident,
  IncidentFilters,
  IncidentResolutionSource,
  IncidentResourceType,
  IncidentStatus,
  IncidentWithResourceName,
} from "../../domain/incidents/types";
import type { Cursor } from "../../shared/pagination";
import { all, isUniqueConstraintError, one, run } from "./d1";

interface IncidentRow {
  id: string;
  workspace_id: string;
  resource_type: IncidentResourceType;
  browser_test_id: string | null;
  uptime_monitor_id: string | null;
  status: IncidentStatus;
  opened_at: number;
  resolved_at: number | null;
  opened_by_run_id: string | null;
  resolved_by_run_id: string | null;
  opened_by_check_id: string | null;
  resolved_by_check_id: string | null;
  last_event_at: number;
  created_at: number;
}

interface IncidentReadRow extends IncidentRow {
  resource_name: string;
}

function toIncident(row: IncidentRow): Incident {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    resourceType: row.resource_type,
    browserTestId: row.browser_test_id,
    uptimeMonitorId: row.uptime_monitor_id,
    status: row.status,
    openedAt: row.opened_at,
    resolvedAt: row.resolved_at,
    openedByRunId: row.opened_by_run_id,
    resolvedByRunId: row.resolved_by_run_id,
    openedByCheckId: row.opened_by_check_id,
    resolvedByCheckId: row.resolved_by_check_id,
    lastEventAt: row.last_event_at,
    createdAt: row.created_at,
  };
}

function toIncidentRead(row: IncidentReadRow): IncidentWithResourceName {
  return { ...toIncident(row), resourceName: row.resource_name };
}

function validateOpenIncident(incident: Incident): void {
  if (incident.status !== "OPEN" || incident.resolvedAt !== null) {
    throw new Error("insertOpen requires an open incident");
  }
  const hasTest = incident.browserTestId !== null;
  const hasMonitor = incident.uptimeMonitorId !== null;
  if (
    hasTest === hasMonitor ||
    (incident.resourceType === "BROWSER_TEST" && !hasTest) ||
    (incident.resourceType === "UPTIME_MONITOR" && !hasMonitor)
  ) {
    throw new Error("Incident resource identity is inconsistent");
  }
}

export class D1IncidentRepo implements IncidentRepo {
  private uptimeTableExists: Promise<boolean> | undefined;

  constructor(private readonly database: D1Database) {}

  private hasUptimeMonitorsTable(): Promise<boolean> {
    this.uptimeTableExists ??= one<{ name: string }>(
      this.database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'uptime_monitors'",
        ),
    ).then((row) => row !== null);
    return this.uptimeTableExists;
  }

  private async resourceReadSql(): Promise<{
    select: string;
    joins: string;
  }> {
    const hasUptimeMonitors = await this.hasUptimeMonitorsTable();
    return hasUptimeMonitors
      ? {
          select:
            "COALESCE(bt.name, um.name, CASE i.resource_type WHEN 'BROWSER_TEST' THEN 'Deleted browser test' ELSE 'Deleted uptime monitor' END) AS resource_name",
          joins: `LEFT JOIN browser_tests bt
                    ON bt.id = i.browser_test_id
                   AND bt.workspace_id = i.workspace_id
                  LEFT JOIN uptime_monitors um
                    ON um.id = i.uptime_monitor_id
                   AND um.workspace_id = i.workspace_id`,
        }
      : {
          select:
            "COALESCE(bt.name, CASE i.resource_type WHEN 'BROWSER_TEST' THEN 'Deleted browser test' ELSE 'Deleted uptime monitor' END) AS resource_name",
          joins: `LEFT JOIN browser_tests bt
                    ON bt.id = i.browser_test_id
                   AND bt.workspace_id = i.workspace_id`,
        };
  }

  async insertOpen(incident: Incident): Promise<Incident> {
    validateOpenIncident(incident);
    try {
      await run(
        this.database
          .prepare(
            `INSERT INTO incidents
              (id, workspace_id, resource_type, browser_test_id,
               uptime_monitor_id, status, opened_at, resolved_at,
               opened_by_run_id, resolved_by_run_id, opened_by_check_id,
               resolved_by_check_id, last_event_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            incident.id,
            incident.workspaceId,
            incident.resourceType,
            incident.browserTestId,
            incident.uptimeMonitorId,
            incident.status,
            incident.openedAt,
            incident.resolvedAt,
            incident.openedByRunId,
            incident.resolvedByRunId,
            incident.openedByCheckId,
            incident.resolvedByCheckId,
            incident.lastEventAt,
            incident.createdAt,
          ),
      );
      return incident;
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const existing =
        incident.browserTestId === null
          ? await this.findOpenForMonitor(incident.uptimeMonitorId as string)
          : await this.findOpenForTest(incident.browserTestId);
      if (existing !== null) return existing;
      throw error;
    }
  }

  async findOpenForTest(testId: string): Promise<Incident | null> {
    const row = await one<IncidentRow>(
      this.database
        .prepare(
          `SELECT * FROM incidents
           WHERE browser_test_id = ? AND status = 'OPEN'`,
        )
        .bind(testId),
    );
    return row === null ? null : toIncident(row);
  }

  async findOpenForMonitor(monitorId: string): Promise<Incident | null> {
    const row = await one<IncidentRow>(
      this.database
        .prepare(
          `SELECT * FROM incidents
           WHERE uptime_monitor_id = ? AND status = 'OPEN'`,
        )
        .bind(monitorId),
    );
    return row === null ? null : toIncident(row);
  }

  async findByRunSource(runId: string): Promise<Incident | null> {
    const row = await one<IncidentRow>(
      this.database
        .prepare(
          `SELECT * FROM incidents
           WHERE opened_by_run_id = ? OR resolved_by_run_id = ?
           ORDER BY CASE WHEN resolved_by_run_id = ? THEN 0 ELSE 1 END, created_at DESC
           LIMIT 1`,
        )
        .bind(runId, runId, runId),
    );
    return row === null ? null : toIncident(row);
  }

  async findByCheckSource(checkId: string): Promise<Incident | null> {
    const row = await one<IncidentRow>(
      this.database
        .prepare(
          `SELECT * FROM incidents
           WHERE opened_by_check_id = ? OR resolved_by_check_id = ?
           ORDER BY CASE WHEN resolved_by_check_id = ? THEN 0 ELSE 1 END, created_at DESC
           LIMIT 1`,
        )
        .bind(checkId, checkId, checkId),
    );
    return row === null ? null : toIncident(row);
  }

  async listOverlappingMonitor(
    monitorId: string,
    fromMs: number,
    toMs: number,
  ): Promise<Incident[]> {
    const rows = await all<IncidentRow>(
      this.database
        .prepare(
          `SELECT * FROM incidents
           WHERE uptime_monitor_id = ?
             AND opened_at < ?
             AND (resolved_at IS NULL OR resolved_at > ?)
           ORDER BY opened_at ASC, id ASC`,
        )
        .bind(monitorId, toMs, fromMs),
    );
    return rows.map(toIncident);
  }

  async findById(
    workspaceId: string,
    id: string,
  ): Promise<IncidentWithResourceName | null> {
    const resource = await this.resourceReadSql();
    const row = await one<IncidentReadRow>(
      this.database
        .prepare(
          `SELECT i.*, ${resource.select}
           FROM incidents i
           ${resource.joins}
           WHERE i.workspace_id = ? AND i.id = ?`,
        )
        .bind(workspaceId, id),
    );
    return row === null ? null : toIncidentRead(row);
  }

  async resolve(
    id: string,
    at: number,
    source: IncidentResolutionSource,
  ): Promise<void> {
    await run(
      this.database
        .prepare(
          `UPDATE incidents
           SET status = 'RESOLVED', resolved_at = ?,
               resolved_by_run_id = ?, resolved_by_check_id = ?,
               last_event_at = MAX(last_event_at, ?)
           WHERE id = ? AND status = 'OPEN'`,
        )
        .bind(at, source.runId ?? null, source.checkId ?? null, at, id),
    );
  }

  async touch(id: string, lastEventAt: number): Promise<void> {
    await run(
      this.database
        .prepare(
          `UPDATE incidents SET last_event_at = MAX(last_event_at, ?)
           WHERE id = ?`,
        )
        .bind(lastEventAt, id),
    );
  }

  async list(
    workspaceId: string,
    filters: IncidentFilters,
    cursor: Cursor | null | undefined,
    limit: number,
  ): Promise<IncidentWithResourceName[]> {
    const conditions = ["i.workspace_id = ?"];
    const values: unknown[] = [workspaceId];
    if (filters.status !== undefined) {
      conditions.push("i.status = ?");
      values.push(filters.status);
    }
    if (filters.resourceType !== undefined) {
      conditions.push("i.resource_type = ?");
      values.push(filters.resourceType);
    }
    if (filters.fromMs !== undefined) {
      conditions.push("i.opened_at >= ?");
      values.push(filters.fromMs);
    }
    if (filters.toMs !== undefined) {
      conditions.push("i.opened_at <= ?");
      values.push(filters.toMs);
    }
    if (cursor !== null && cursor !== undefined) {
      conditions.push(
        "(i.opened_at < ? OR (i.opened_at = ? AND i.id < ?))",
      );
      values.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    values.push(limit);
    const resource = await this.resourceReadSql();
    const rows = await all<IncidentReadRow>(
      this.database
        .prepare(
          `SELECT i.*, ${resource.select}
           FROM incidents i
           ${resource.joins}
           WHERE ${conditions.join(" AND ")}
           ORDER BY i.opened_at DESC, i.id DESC
           LIMIT ?`,
        )
        .bind(...values),
    );
    return rows.map(toIncidentRead);
  }
}
