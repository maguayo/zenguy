import type { Cursor } from "../../shared/pagination";
import type {
  Incident,
  IncidentEvent,
  IncidentFilters,
  IncidentResolutionSource,
} from "./types";

export interface IncidentRepo {
  insertOpen(incident: Incident): Promise<Incident>;
  findOpenForTest(testId: string): Promise<Incident | null>;
  findOpenForMonitor(monitorId: string): Promise<Incident | null>;
  findById(workspaceId: string, id: string): Promise<Incident | null>;
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
  ): Promise<Incident[]>;
}

export interface IncidentEventRepo {
  insert(event: IncidentEvent): Promise<void>;
  listForIncident(incidentId: string): Promise<IncidentEvent[]>;
}
