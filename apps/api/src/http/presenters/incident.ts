import type {
  IncidentDetailOutput,
  IncidentListItemOutput,
} from "../../application/incidents/incident_models";

function iso(value: number): string {
  return new Date(value).toISOString();
}

function nullableIso(value: number | null): string | null {
  return value === null ? null : iso(value);
}

export function presentIncident(incident: IncidentListItemOutput) {
  return {
    ...incident,
    openedAt: iso(incident.openedAt),
    resolvedAt: nullableIso(incident.resolvedAt),
    lastEventAt: iso(incident.lastEventAt),
  };
}

export function presentIncidentDetail(incident: IncidentDetailOutput) {
  return {
    ...presentIncident(incident),
    openedByRunId: incident.openedByRunId,
    openedByCheckId: incident.openedByCheckId,
    events: incident.events.map((event) => ({
      ...event,
      createdAt: iso(event.createdAt),
    })),
    deliveries: incident.deliveries.map((delivery) => ({
      ...delivery,
      sentAt: nullableIso(delivery.sentAt),
      createdAt: iso(delivery.createdAt),
    })),
  };
}
