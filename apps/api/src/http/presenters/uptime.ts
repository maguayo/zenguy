import type { MonitorOutput } from "../../application/uptime/types";

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
