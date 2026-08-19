import type { IncidentRepo } from "../../domain/incidents/repo";
import type { Incident } from "../../domain/incidents/types";
import type { CheckRepo, MonitorRepo } from "../../domain/uptime/repo";
import type { CheckStatus, UptimeSeriesPoint } from "../../domain/uptime/types";
import type { Clock } from "../../shared/clock";
import { notFound } from "../../shared/errors";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const SERIES_LIMIT = 288;

export interface MonitorStatsOutput {
  uptime24h: number | null;
  uptime7d: number | null;
  uptime30d: number | null;
  avgResponseTimeMs24h: number | null;
  series: {
    t: number;
    responseTimeMs: number | null;
    status: CheckStatus;
  }[];
}

function roundedUptime(
  windowMs: number,
  windowStart: number,
  now: number,
  incidents: Incident[],
): number {
  const downtime = incidents.reduce((total, incident) => {
    const start = Math.max(windowStart, incident.openedAt);
    const end = Math.min(now, incident.resolvedAt ?? now);
    return total + Math.max(0, end - start);
  }, 0);
  const boundedDowntime = Math.min(windowMs, downtime);
  return Math.round((100 * (windowMs - boundedDowntime) * 100) / windowMs) / 100;
}

function uptimeForWindow(input: {
  windowMs: number;
  now: number;
  monitorCreatedAt: number;
  checks: UptimeSeriesPoint[];
  incidents: Incident[];
}): number | null {
  const windowStart = input.now - input.windowMs;
  const hasCheck = input.checks.some(
    (check) => check.checkedAt >= windowStart && check.checkedAt <= input.now,
  );
  if (input.monitorCreatedAt > windowStart && !hasCheck) return null;
  return roundedUptime(
    input.windowMs,
    windowStart,
    input.now,
    input.incidents,
  );
}

export function downsampleEvenly<T>(points: T[], limit = SERIES_LIMIT): T[] {
  if (points.length <= limit) return [...points];
  return Array.from({ length: limit }, (_, index) =>
    points[Math.round((index * (points.length - 1)) / (limit - 1))] as T,
  );
}

export class GetMonitorStats {
  constructor(
    private readonly monitors: MonitorRepo,
    private readonly checks: CheckRepo,
    private readonly incidents: Pick<IncidentRepo, "listOverlappingMonitor">,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    workspaceId: string;
    monitorId: string;
  }): Promise<MonitorStatsOutput> {
    const monitor = await this.monitors.findById(
      input.workspaceId,
      input.monitorId,
    );
    if (monitor === null) throw notFound("Uptime monitor");
    const now = this.clock.now();
    const from30d = now - 30 * DAY_MS;
    const from24h = now - DAY_MS;
    const [checks, incidents, average] = await Promise.all([
      this.checks.seriesSince(monitor.id, from30d),
      this.incidents.listOverlappingMonitor(monitor.id, from30d, now),
      this.checks.avgResponseTime({ monitorId: monitor.id }, from24h),
    ]);
    const uptime = (windowMs: number) =>
      uptimeForWindow({
        windowMs,
        now,
        monitorCreatedAt: monitor.createdAt,
        checks,
        incidents,
      });
    const recent = checks.filter(
      (check) => check.checkedAt >= from24h && check.checkedAt <= now,
    );
    return {
      uptime24h: uptime(DAY_MS),
      uptime7d: uptime(7 * DAY_MS),
      uptime30d: uptime(30 * DAY_MS),
      avgResponseTimeMs24h: average,
      series: downsampleEvenly(recent).map((point) => ({
        t: point.checkedAt,
        responseTimeMs: point.responseTimeMs,
        status: point.status,
      })),
    };
  }
}
