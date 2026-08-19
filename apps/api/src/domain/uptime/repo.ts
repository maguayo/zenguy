import type { Cursor } from "../../shared/pagination";
import type {
  BodyCondition,
  ClaimedUptimeMonitor,
  MonitorMethod,
  MonitorStatusCounts,
  UptimeCheck,
  UptimeMonitor,
  UptimeSeriesPoint,
} from "./types";

export interface MonitorUpdate {
  name?: string;
  url?: string;
  method?: MonitorMethod;
  encryptedHeaders?: string | null;
  encryptedBody?: string | null;
  expectedStatus?: number;
  bodyCondition?: BodyCondition | null;
  bodyExpectedValue?: string | null;
  bodyConditionPath?: string | null;
  frequencySeconds?: number;
  timeoutSeconds?: number;
  maxRetries?: number;
  notifyOnRecovery?: boolean;
  nextCheckAt?: number;
}

export interface CloseMonitorCycle {
  status: "UP" | "DOWN";
  lastCheckAt: number;
  lastResponseTimeMs: number | null;
}

export type CheckInsertResult = "inserted" | "duplicate";
export type CheckAverageScope =
  | { monitorId: string }
  | { workspaceId: string };

export interface MonitorRepo {
  insert(monitor: UptimeMonitor): Promise<void>;
  findById(workspaceId: string, id: string): Promise<UptimeMonitor | null>;
  list(workspaceId: string): Promise<UptimeMonitor[]>;
  update(id: string, changes: MonitorUpdate, at: number): Promise<void>;
  softDelete(id: string, at: number): Promise<void>;
  claimDue(now: number, limit: number): Promise<ClaimedUptimeMonitor[]>;
  openCycle(id: string, cycleId: string, at: number): Promise<boolean>;
  closeCycle(id: string, changes: CloseMonitorCycle): Promise<void>;
  listZombieCycles(before: number): Promise<UptimeMonitor[]>;
  clearCycle(id: string): Promise<void>;
  setChannels(monitorId: string, channelIds: string[]): Promise<void>;
  getChannelIds(monitorId: string): Promise<string[]>;
  statusCounts(workspaceId: string): Promise<MonitorStatusCounts>;
}

export interface CheckRepo {
  findByCycleAttempt(
    cycleId: string,
    attemptIndex: number,
  ): Promise<UptimeCheck | null>;
  insertIfAbsent(check: UptimeCheck): Promise<CheckInsertResult>;
  listForMonitor(
    monitorId: string,
    cursor: Cursor | null | undefined,
    limit: number,
  ): Promise<UptimeCheck[]>;
  seriesSince(monitorId: string, fromMs: number): Promise<UptimeSeriesPoint[]>;
  avgResponseTime(
    scope: CheckAverageScope,
    fromMs: number,
  ): Promise<number | null>;
  deleteOlderThan(before: number, limit: number): Promise<number>;
}
