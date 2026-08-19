import { apiGet, apiGetPage, type ApiPage } from "../lib/api";
import type { Incident, IncidentDetail } from "./types";

export interface IncidentFilters {
  from?: string | null;
  status?: "open" | "resolved" | null;
  to?: string | null;
  type?: "browser" | "uptime" | null;
}

function incidentsBasePath(workspaceId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/incidents`;
}

export function incidentsPath(
  workspaceId: string,
  filters: IncidentFilters = {},
  cursor?: string | null,
  limit = 25,
): string {
  const search = new URLSearchParams({ limit: String(limit) });
  if (filters.status) search.set("status", filters.status);
  if (filters.type) search.set("type", filters.type);
  if (filters.from) search.set("from", filters.from);
  if (filters.to) search.set("to", filters.to);
  if (cursor) search.set("cursor", cursor);
  return `${incidentsBasePath(workspaceId)}?${search}`;
}

export function listIncidents(
  workspaceId: string,
  filters: IncidentFilters = {},
  cursor?: string | null,
  limit = 25,
): Promise<ApiPage<Incident>> {
  return apiGetPage(incidentsPath(workspaceId, filters, cursor, limit));
}

export function getIncident(workspaceId: string, incidentId: string): Promise<IncidentDetail> {
  return apiGet(`${incidentsBasePath(workspaceId)}/${encodeURIComponent(incidentId)}`);
}
