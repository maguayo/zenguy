export type MonitorMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD";

export type BodyCondition =
  | "CONTAINS"
  | "NOT_CONTAINS"
  | "EQUALS"
  | "JSON_PATH_EQUALS";

export type MonitorStatus = "UNKNOWN" | "UP" | "DOWN";
export type CheckStatus = "PASSED" | "FAILED";

export interface MonitorHeader {
  key: string;
  value: string;
}

export interface UptimeMonitor {
  id: string;
  workspaceId: string;
  name: string;
  url: string;
  method: MonitorMethod;
  encryptedHeaders: string | null;
  encryptedBody: string | null;
  expectedStatus: number;
  bodyCondition: BodyCondition | null;
  bodyExpectedValue: string | null;
  bodyConditionPath: string | null;
  frequencySeconds: number;
  timeoutSeconds: number;
  maxRetries: number;
  notifyOnRecovery: boolean;
  nextCheckAt: number;
  currentStatus: MonitorStatus;
  currentCycleId: string | null;
  cycleStartedAt: number | null;
  lastCheckAt: number | null;
  lastResponseTimeMs: number | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface ClaimedUptimeMonitor extends UptimeMonitor {
  scheduledFor: number;
}

export interface UptimeCheck {
  id: string;
  workspaceId: string;
  uptimeMonitorId: string;
  cycleId: string;
  attemptIndex: number;
  status: CheckStatus;
  httpStatus: number | null;
  responseTimeMs: number | null;
  failureReason: string | null;
  responseExcerpt: string | null;
  checkedAt: number;
  createdAt: number;
}

export interface UptimeSeriesPoint {
  checkedAt: number;
  responseTimeMs: number | null;
  status: CheckStatus;
}

export interface MonitorStatusCounts {
  up: number;
  down: number;
  unknown: number;
}

/** One recent check result for a history strip; lists are oldest first. */
export interface CheckTick {
  id: string;
  status: CheckStatus;
  checkedAt: number;
}
