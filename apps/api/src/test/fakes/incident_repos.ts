import type {
  IncidentEventRepo,
  IncidentRepo,
} from "../../domain/incidents/repo";
import type {
  Incident,
  IncidentEvent,
  IncidentFilters,
  IncidentResolutionSource,
  IncidentWithResourceName,
} from "../../domain/incidents/types";
import type { Cursor } from "../../shared/pagination";

function copy<T>(value: T): T {
  return structuredClone(value);
}

function openResourceMatches(left: Incident, right: Incident): boolean {
  return (
    left.status === "OPEN" &&
    right.status === "OPEN" &&
    ((left.browserTestId !== null &&
      left.browserTestId === right.browserTestId) ||
      (left.uptimeMonitorId !== null &&
        left.uptimeMonitorId === right.uptimeMonitorId))
  );
}

export class FakeIncidentRepo implements IncidentRepo {
  readonly incidents = new Map<string, Incident>();
  readonly resourceNames = new Map<string, string>();

  setResourceName(resourceId: string, name: string): void {
    this.resourceNames.set(resourceId, name);
  }

  private withResourceName(incident: Incident): IncidentWithResourceName {
    const resourceId =
      incident.browserTestId ?? incident.uptimeMonitorId ?? "unknown";
    return {
      ...copy(incident),
      resourceName:
        this.resourceNames.get(resourceId) ??
        (incident.resourceType === "BROWSER_TEST"
          ? "Deleted browser test"
          : "Deleted uptime monitor"),
    };
  }

  async insertOpen(incident: Incident): Promise<Incident> {
    const existing = [...this.incidents.values()].find((candidate) =>
      openResourceMatches(candidate, incident),
    );
    if (existing !== undefined) return copy(existing);
    if (this.incidents.has(incident.id)) {
      throw new Error("incident constraint violation");
    }
    this.incidents.set(incident.id, copy(incident));
    return copy(incident);
  }

  async findOpenForTest(testId: string): Promise<Incident | null> {
    const incident = [...this.incidents.values()].find(
      (candidate) =>
        candidate.status === "OPEN" && candidate.browserTestId === testId,
    );
    return incident === undefined ? null : copy(incident);
  }

  async findOpenForMonitor(monitorId: string): Promise<Incident | null> {
    const incident = [...this.incidents.values()].find(
      (candidate) =>
        candidate.status === "OPEN" &&
        candidate.uptimeMonitorId === monitorId,
    );
    return incident === undefined ? null : copy(incident);
  }

  async findById(
    workspaceId: string,
    id: string,
  ): Promise<IncidentWithResourceName | null> {
    const incident = this.incidents.get(id);
    return incident === undefined || incident.workspaceId !== workspaceId
      ? null
      : this.withResourceName(incident);
  }

  async resolve(
    id: string,
    at: number,
    source: IncidentResolutionSource,
  ): Promise<void> {
    const incident = this.incidents.get(id);
    if (incident === undefined || incident.status !== "OPEN") return;
    this.incidents.set(id, {
      ...incident,
      status: "RESOLVED",
      resolvedAt: at,
      resolvedByRunId: source.runId ?? null,
      resolvedByCheckId: source.checkId ?? null,
      lastEventAt: Math.max(incident.lastEventAt, at),
    });
  }

  async touch(id: string, lastEventAt: number): Promise<void> {
    const incident = this.incidents.get(id);
    if (incident !== undefined) {
      this.incidents.set(id, {
        ...incident,
        lastEventAt: Math.max(incident.lastEventAt, lastEventAt),
      });
    }
  }

  async list(
    workspaceId: string,
    filters: IncidentFilters,
    cursor: Cursor | null | undefined,
    limit: number,
  ): Promise<IncidentWithResourceName[]> {
    return [...this.incidents.values()]
      .filter(
        (incident) =>
          incident.workspaceId === workspaceId &&
          (filters.status === undefined ||
            incident.status === filters.status) &&
          (filters.resourceType === undefined ||
            incident.resourceType === filters.resourceType) &&
          (filters.fromMs === undefined ||
            incident.openedAt >= filters.fromMs) &&
          (filters.toMs === undefined || incident.openedAt <= filters.toMs) &&
          (cursor === null ||
            cursor === undefined ||
            incident.openedAt < cursor.createdAt ||
            (incident.openedAt === cursor.createdAt &&
              incident.id < cursor.id)),
      )
      .sort(
        (left, right) =>
          right.openedAt - left.openedAt || right.id.localeCompare(left.id),
      )
      .slice(0, limit)
      .map((incident) => this.withResourceName(incident));
  }
}

export class FakeIncidentEventRepo implements IncidentEventRepo {
  readonly events = new Map<string, IncidentEvent>();

  async insert(event: IncidentEvent): Promise<void> {
    if (this.events.has(event.id)) {
      throw new Error("incident event constraint violation");
    }
    this.events.set(event.id, copy(event));
  }

  async listForIncident(incidentId: string): Promise<IncidentEvent[]> {
    return [...this.events.values()]
      .filter((event) => event.incidentId === incidentId)
      .sort(
        (left, right) =>
          left.createdAt - right.createdAt || left.id.localeCompare(right.id),
      )
      .map(copy);
  }
}
