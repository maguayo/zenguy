export type IncidentResourceType = "BROWSER_TEST" | "UPTIME_MONITOR";
export type IncidentStatus = "OPEN" | "RESOLVED";
export type IncidentEventType =
  | "OPENED"
  | "FAILURE_RECORDED"
  | "NOTIFICATION_SENT"
  | "NOTIFICATION_FAILED"
  | "RESOLVED"
  | "TEST_DELETED"
  | "MONITOR_DELETED";

export interface Incident {
  id: string;
  workspaceId: string;
  resourceType: IncidentResourceType;
  browserTestId: string | null;
  uptimeMonitorId: string | null;
  status: IncidentStatus;
  openedAt: number;
  resolvedAt: number | null;
  openedByRunId: string | null;
  resolvedByRunId: string | null;
  openedByCheckId: string | null;
  resolvedByCheckId: string | null;
  lastEventAt: number;
  createdAt: number;
}

export interface IncidentWithResourceName extends Incident {
  resourceName: string;
}

export interface IncidentEvent {
  id: string;
  incidentId: string;
  type: IncidentEventType;
  sourceId: string | null;
  message: string;
  metadataJson: string | null;
  createdAt: number;
}

export interface IncidentFilters {
  status?: IncidentStatus;
  resourceType?: IncidentResourceType;
  fromMs?: number;
  toMs?: number;
}

export interface IncidentResolutionSource {
  runId?: string;
  checkId?: string;
}
