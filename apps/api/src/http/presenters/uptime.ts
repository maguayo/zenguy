import type { MonitorOutput } from "../../application/uptime/types";
import type { CheckListItemOutput } from "../../application/uptime/list_checks";
import type { MonitorStatsOutput } from "../../application/uptime/get_monitor_stats";

function nullableIso(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

export function presentMonitor(monitor: MonitorOutput) {
  return {
    ...monitor,
    nextCheckAt: new Date(monitor.nextCheckAt).toISOString(),
    lastCheckAt: nullableIso(monitor.lastCheckAt),
    createdAt: new Date(monitor.createdAt).toISOString(),
    updatedAt: new Date(monitor.updatedAt).toISOString(),
  };
}

export function presentCheck(check: CheckListItemOutput) {
  return { ...check, checkedAt: new Date(check.checkedAt).toISOString() };
}

export function presentMonitorStats(stats: MonitorStatsOutput) {
  return {
    ...stats,
    series: stats.series.map((point) => ({
      ...point,
      t: new Date(point.t).toISOString(),
    })),
  };
}
