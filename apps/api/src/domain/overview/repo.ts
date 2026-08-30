import type { RunStatus } from "../browser_tests/types";
import type { IncidentResourceType } from "../incidents/types";

export type OverviewRunStatus = Extract<
  RunStatus,
  "PASSED" | "FAILED" | "TIMEOUT" | "SYSTEM_ERROR"
>;

export interface OverviewBrowserCounts {
  total: number;
  runningRuns: number;
  openIncidents: number;
  failed24h: number;
}

export interface OverviewUptimeCounts {
  up: number;
  down: number;
  unknown: number;
  openIncidents: number;
  avgResponseTimeMs24h: number | null;
  /** Incident-based availability, weighted by observable live-monitor time. */
  uptime30d: number | null;
}

export interface OverviewFinishedRun {
  id: string;
  browserTestId: string;
  status: OverviewRunStatus;
  testName: string;
  finishedAt: number;
}

export interface OverviewRunningRun {
  id: string;
  browserTestId: string | null;
  testName: string;
  startedAt: number;
}

export interface OverviewIncidentEvent {
  id: string;
  resourceType: IncidentResourceType;
  resourceId: string;
  resourceName: string;
  occurredAt: number;
}

export interface OverviewFailedDelivery {
  id: string;
  channelId: string;
  channelName: string;
  occurredAt: number;
}

export interface OverviewRepo {
  getBrowserCounts(
    workspaceId: string,
    fromMs: number,
    toMs: number,
  ): Promise<OverviewBrowserCounts>;
  getUptimeCounts(
    workspaceId: string,
    from24hMs: number,
    from30dMs: number,
    toMs: number,
  ): Promise<OverviewUptimeCounts>;
  listFinishedRuns(
    workspaceId: string,
    toMs: number,
    limit: number,
  ): Promise<OverviewFinishedRun[]>;
  listRunningRuns(
    workspaceId: string,
    limit: number,
  ): Promise<OverviewRunningRun[]>;
  listResolvedIncidents(
    workspaceId: string,
    fromMs: number,
    toMs: number,
    limit: number,
  ): Promise<OverviewIncidentEvent[]>;
  listOpenedUptimeIncidents(
    workspaceId: string,
    toMs: number,
    limit: number,
  ): Promise<OverviewIncidentEvent[]>;
  listFailedDeliveries(
    workspaceId: string,
    fromMs: number,
    toMs: number,
    limit: number,
  ): Promise<OverviewFailedDelivery[]>;
}
