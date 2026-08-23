import type { User } from "../../domain/users/types";
import type { Incident } from "../../domain/incidents/types";
import type {
  BodyCondition,
  MonitorHeader,
  MonitorMethod,
  CheckTick,
  MonitorStatus,
  UptimeMonitor,
} from "../../domain/uptime/types";
import type { Role } from "../../domain/workspaces/types";
import { readMonitorSensitive } from "./monitor_secrets";

export interface MonitorOutput {
  id: string;
  name: string;
  url: string;
  method: MonitorMethod;
  headers: MonitorHeader[] | null;
  body: string | null;
  headersMasked: boolean;
  expectedStatus: number;
  bodyCondition: BodyCondition | null;
  bodyExpectedValue: string | null;
  bodyConditionPath: string | null;
  frequencySeconds: number;
  timeoutSeconds: number;
  maxRetries: number;
  notifyOnRecovery: boolean;
  channelIds: string[];
  status: MonitorStatus;
  checking: boolean;
  nextCheckAt: number;
  lastCheckAt: number | null;
  lastResponseTimeMs: number | null;
  openIncidentId: string | null;
  recentChecks: CheckTick[];
  createdBy: { userId: string; name: string } | null;
  createdAt: number;
  updatedAt: number;
}

export async function monitorOutput(input: {
  monitor: UptimeMonitor;
  channelIds: string[];
  creator: User | null;
  incident: Incident | null;
  recentChecks?: CheckTick[];
  role: Role;
  encryptionKey: Uint8Array;
}): Promise<MonitorOutput> {
  const sensitive = await readMonitorSensitive(
    input.monitor,
    input.encryptionKey,
    input.role === "OWNER" || input.role === "ADMIN",
  );
  return {
    id: input.monitor.id,
    name: input.monitor.name,
    url: input.monitor.url,
    method: input.monitor.method,
    headers: sensitive.headers,
    body: sensitive.body,
    headersMasked: sensitive.headersMasked,
    expectedStatus: input.monitor.expectedStatus,
    bodyCondition: input.monitor.bodyCondition,
    bodyExpectedValue: input.monitor.bodyExpectedValue,
    bodyConditionPath: input.monitor.bodyConditionPath,
    frequencySeconds: input.monitor.frequencySeconds,
    timeoutSeconds: input.monitor.timeoutSeconds,
    maxRetries: input.monitor.maxRetries,
    notifyOnRecovery: input.monitor.notifyOnRecovery,
    channelIds: [...input.channelIds],
    status: input.monitor.currentStatus,
    checking: input.monitor.currentCycleId !== null,
    nextCheckAt: input.monitor.nextCheckAt,
    lastCheckAt: input.monitor.lastCheckAt,
    lastResponseTimeMs: input.monitor.lastResponseTimeMs,
    openIncidentId:
      input.incident?.workspaceId === input.monitor.workspaceId
        ? input.incident.id
        : null,
    recentChecks: (input.recentChecks ?? []).map((tick) => ({ ...tick })),
    createdBy:
      input.creator === null
        ? null
        : { userId: input.creator.id, name: input.creator.name },
    createdAt: input.monitor.createdAt,
    updatedAt: input.monitor.updatedAt,
  };
}
