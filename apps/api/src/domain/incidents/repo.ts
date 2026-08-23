import type { Cursor } from "../../shared/pagination";
import type {
  Incident,
  IncidentEvent,
  IncidentFilters,
  IncidentResolutionSource,
  IncidentWithResourceName,
} from "./types";

export interface IncidentRepo {
  insertOpen(incident: Incident): Promise<Incident>;
  findOpenForTest(testId: string): Promise<Incident | null>;
  findOpenForMonitor(monitorId: string): Promise<Incident | null>;
  findOpenForMonitors(
    workspaceId: string,
    monitorIds: string[],
  ): Promise<Map<string, Incident>>;
  findByRunSource(runId: string): Promise<Incident | null>;
  findByCheckSource(checkId: string): Promise<Incident | null>;
  listOverlappingMonitor(
    monitorId: string,
    fromMs: number,
    toMs: number,
  ): Promise<Incident[]>;
  findById(
    workspaceId: string,
    id: string,
  ): Promise<IncidentWithResourceName | null>;
  resolve(
    id: string,
    at: number,
    source: IncidentResolutionSource,
  ): Promise<void>;
  touch(id: string, lastEventAt: number): Promise<void>;
  list(
    workspaceId: string,
    filters: IncidentFilters,
    cursor: Cursor | null | undefined,
    limit: number,
  ): Promise<IncidentWithResourceName[]>;
}

export interface IncidentEventRepo {
  insert(event: IncidentEvent): Promise<void>;
  listForIncident(incidentId: string): Promise<IncidentEvent[]>;
}
