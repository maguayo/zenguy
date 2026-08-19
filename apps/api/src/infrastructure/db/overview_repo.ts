import type {
  OverviewBrowserCounts,
  OverviewFailedDelivery,
  OverviewFinishedRun,
  OverviewIncidentEvent,
  OverviewRepo,
  OverviewRunStatus,
  OverviewUptimeCounts,
} from "../../domain/overview/repo";
import type { IncidentResourceType } from "../../domain/incidents/types";
import { all, one } from "./d1";

interface BrowserCountsRow {
  total: number;
  running_runs: number;
  open_incidents: number;
  failed_24h: number;
}

interface UptimeCountsRow {
  up: number;
  down: number;
  unknown: number;
  open_incidents: number;
  avg_response_time_ms_24h: number | null;
}

interface FinishedRunRow {
  id: string;
  browser_test_id: string;
  status: OverviewRunStatus;
  snapshot_json: string;
  fallback_name: string;
  finished_at: number;
}

interface IncidentEventRow {
  id: string;
  resource_type: IncidentResourceType;
  resource_id: string;
  resource_name: string;
  occurred_at: number;
}

interface FailedDeliveryRow {
  id: string;
  channel_id: string;
  channel_name: string;
  occurred_at: number;
}

function requiredRow<T>(row: T | null): T {
  if (row === null) throw new Error("Overview aggregate query returned no row");
  return row;
}

function testName(snapshotJson: string, fallback: string): string {
  try {
    const parsed = JSON.parse(snapshotJson) as { name?: unknown };
    return typeof parsed.name === "string" && parsed.name.length > 0
      ? parsed.name
      : fallback;
  } catch {
    return fallback;
  }
}

function toIncidentEvent(row: IncidentEventRow): OverviewIncidentEvent {
  return {
    id: row.id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    resourceName: row.resource_name,
    occurredAt: row.occurred_at,
  };
}

export class D1OverviewRepo implements OverviewRepo {
  constructor(private readonly database: D1Database) {}

  async getBrowserCounts(
    workspaceId: string,
    fromMs: number,
    toMs: number,
  ): Promise<OverviewBrowserCounts> {
    const row = requiredRow(
      await one<BrowserCountsRow>(
        this.database
          .prepare(
            `SELECT
               (SELECT COUNT(*) FROM browser_tests
                WHERE workspace_id = ? AND deleted_at IS NULL) AS total,
               (SELECT COUNT(*) FROM test_runs
                WHERE workspace_id = ? AND status = 'RUNNING') AS running_runs,
               (SELECT COUNT(*) FROM incidents
                WHERE workspace_id = ? AND resource_type = 'BROWSER_TEST'
                  AND status = 'OPEN') AS open_incidents,
               (SELECT COUNT(*) FROM test_runs
                WHERE workspace_id = ? AND source != 'VALIDATION'
                  AND status IN ('FAILED', 'TIMEOUT')
                  AND finished_at >= ? AND finished_at <= ?) AS failed_24h`,
          )
          .bind(
            workspaceId,
            workspaceId,
            workspaceId,
            workspaceId,
            fromMs,
            toMs,
          ),
      ),
    );
    return {
      total: row.total,
      runningRuns: row.running_runs,
      openIncidents: row.open_incidents,
      failed24h: row.failed_24h,
    };
  }

  async getUptimeCounts(
    workspaceId: string,
    fromMs: number,
    toMs: number,
  ): Promise<OverviewUptimeCounts> {
    const row = requiredRow(
      await one<UptimeCountsRow>(
        this.database
          .prepare(
            `SELECT
               (SELECT COUNT(*) FROM uptime_monitors
                WHERE workspace_id = ? AND deleted_at IS NULL
                  AND current_status = 'UP') AS up,
               (SELECT COUNT(*) FROM uptime_monitors
                WHERE workspace_id = ? AND deleted_at IS NULL
                  AND current_status = 'DOWN') AS down,
               (SELECT COUNT(*) FROM uptime_monitors
                WHERE workspace_id = ? AND deleted_at IS NULL
                  AND current_status = 'UNKNOWN') AS unknown,
               (SELECT COUNT(*) FROM incidents
                WHERE workspace_id = ? AND resource_type = 'UPTIME_MONITOR'
                  AND status = 'OPEN') AS open_incidents,
               (SELECT AVG(response_time_ms) FROM uptime_checks
                WHERE workspace_id = ? AND checked_at >= ? AND checked_at <= ?
                  AND response_time_ms IS NOT NULL) AS avg_response_time_ms_24h`,
          )
          .bind(
            workspaceId,
            workspaceId,
            workspaceId,
            workspaceId,
            workspaceId,
            fromMs,
            toMs,
          ),
      ),
    );
    return {
      up: row.up,
      down: row.down,
      unknown: row.unknown,
      openIncidents: row.open_incidents,
      avgResponseTimeMs24h: row.avg_response_time_ms_24h,
    };
  }

  async listFinishedRuns(
    workspaceId: string,
    toMs: number,
    limit: number,
  ): Promise<OverviewFinishedRun[]> {
    const rows = await all<FinishedRunRow>(
      this.database
        .prepare(
          `SELECT r.id, r.browser_test_id, r.status, r.snapshot_json,
                  COALESCE(bt.name, 'Deleted browser test') AS fallback_name,
                  r.finished_at
           FROM test_runs r
           LEFT JOIN browser_tests bt
             ON bt.id = r.browser_test_id AND bt.workspace_id = r.workspace_id
           WHERE r.workspace_id = ? AND r.source != 'VALIDATION'
             AND r.browser_test_id IS NOT NULL
             AND r.status IN ('PASSED', 'FAILED', 'TIMEOUT', 'SYSTEM_ERROR')
             AND r.finished_at IS NOT NULL AND r.finished_at <= ?
           ORDER BY r.finished_at DESC, r.id DESC LIMIT ?`,
        )
        .bind(workspaceId, toMs, limit),
    );
    return rows.map((row) => ({
      id: row.id,
      browserTestId: row.browser_test_id,
      status: row.status,
      testName: testName(row.snapshot_json, row.fallback_name),
      finishedAt: row.finished_at,
    }));
  }

  async listResolvedIncidents(
    workspaceId: string,
    fromMs: number,
    toMs: number,
    limit: number,
  ): Promise<OverviewIncidentEvent[]> {
    const rows = await all<IncidentEventRow>(
      this.database
        .prepare(
          `SELECT i.id, i.resource_type,
                  COALESCE(i.browser_test_id, i.uptime_monitor_id) AS resource_id,
                  COALESCE(
                    bt.name,
                    um.name,
                    CASE i.resource_type
                      WHEN 'BROWSER_TEST' THEN 'Deleted browser test'
                      ELSE 'Deleted uptime monitor'
                    END
                  ) AS resource_name,
                  i.resolved_at AS occurred_at
           FROM incidents i
           LEFT JOIN browser_tests bt
             ON bt.id = i.browser_test_id AND bt.workspace_id = i.workspace_id
           LEFT JOIN uptime_monitors um
             ON um.id = i.uptime_monitor_id AND um.workspace_id = i.workspace_id
           WHERE i.workspace_id = ? AND i.status = 'RESOLVED'
             AND i.resolved_at >= ? AND i.resolved_at <= ?
           ORDER BY i.resolved_at DESC, i.id DESC LIMIT ?`,
        )
        .bind(workspaceId, fromMs, toMs, limit),
    );
    return rows.map(toIncidentEvent);
  }

  async listOpenedUptimeIncidents(
    workspaceId: string,
    toMs: number,
    limit: number,
  ): Promise<OverviewIncidentEvent[]> {
    const rows = await all<IncidentEventRow>(
      this.database
        .prepare(
          `SELECT i.id, i.resource_type, i.uptime_monitor_id AS resource_id,
                  COALESCE(um.name, 'Deleted uptime monitor') AS resource_name,
                  i.opened_at AS occurred_at
           FROM incidents i
           LEFT JOIN uptime_monitors um
             ON um.id = i.uptime_monitor_id AND um.workspace_id = i.workspace_id
           WHERE i.workspace_id = ? AND i.resource_type = 'UPTIME_MONITOR'
             AND i.uptime_monitor_id IS NOT NULL AND i.opened_at <= ?
           ORDER BY i.opened_at DESC, i.id DESC LIMIT ?`,
        )
        .bind(workspaceId, toMs, limit),
    );
    return rows.map(toIncidentEvent);
  }

  async listFailedDeliveries(
    workspaceId: string,
    fromMs: number,
    toMs: number,
    limit: number,
  ): Promise<OverviewFailedDelivery[]> {
    const rows = await all<FailedDeliveryRow>(
      this.database
        .prepare(
          `SELECT d.id, d.notification_channel_id AS channel_id,
                  COALESCE(c.name, 'Deleted channel') AS channel_name,
                  d.created_at AS occurred_at
           FROM notification_deliveries d
           LEFT JOIN notification_channels c
             ON c.id = d.notification_channel_id
            AND c.workspace_id = d.workspace_id
           WHERE d.workspace_id = ? AND d.status = 'FAILED'
             AND d.created_at >= ? AND d.created_at <= ?
           ORDER BY d.created_at DESC, d.id DESC LIMIT ?`,
        )
        .bind(workspaceId, fromMs, toMs, limit),
    );
    return rows.map((row) => ({
      id: row.id,
      channelId: row.channel_id,
      channelName: row.channel_name,
      occurredAt: row.occurred_at,
    }));
  }
}
