export type StatusPageTheme = "LIGHT" | "DARK" | "SYSTEM";
export type StatusPageResourceType = "BROWSER_TEST" | "UPTIME_MONITOR";

export interface StatusPage {
  id: string;
  workspaceId: string;
  slug: string;
  title: string;
  description: string | null;
  accentColor: string | null;
  theme: StatusPageTheme;
  publishedAt: number | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface StatusPageItem {
  id: string;
  statusPageId: string;
  workspaceId: string;
  resourceType: StatusPageResourceType;
  browserTestId: string | null;
  uptimeMonitorId: string | null;
  displayName: string;
  groupName: string | null;
  position: number;
  createdAt: number;
}

export interface IncidentUpdate {
  id: string;
  incidentId: string;
  workspaceId: string;
  message: string;
  createdBy: string | null;
  createdAt: number;
}
