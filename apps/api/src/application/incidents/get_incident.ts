import type { DeliveryRepo } from "../../domain/channels/repo";
import type {
  IncidentEventRepo,
  IncidentRepo,
} from "../../domain/incidents/repo";
import type { Clock } from "../../shared/clock";
import { notFound } from "../../shared/errors";
import type { IncidentDetailOutput } from "./incident_models";
import { incidentListItemOutput } from "./list_incidents";

function metadata(value: string | null): Record<string, unknown> | null {
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export class GetIncident {
  constructor(
    private readonly incidents: IncidentRepo,
    private readonly events: IncidentEventRepo,
    private readonly deliveries: DeliveryRepo,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    workspaceId: string;
    incidentId: string;
  }): Promise<IncidentDetailOutput> {
    const incident = await this.incidents.findById(
      input.workspaceId,
      input.incidentId,
    );
    if (incident === null) throw notFound("Incident");
    const [events, deliveries] = await Promise.all([
      this.events.listForIncident(incident.id),
      this.deliveries.listForIncidentWithChannel(incident.id),
    ]);
    return {
      ...incidentListItemOutput(incident, this.clock.now()),
      openedByRunId: incident.openedByRunId,
      openedByCheckId: incident.openedByCheckId,
      events: events.map((event) => ({
        id: event.id,
        type: event.type,
        message: event.message,
        metadata: metadata(event.metadataJson),
        createdAt: event.createdAt,
      })),
      deliveries: deliveries.map((delivery) => ({
        id: delivery.id,
        channelName: delivery.channelName,
        channelType: delivery.channelType,
        eventType: delivery.eventType,
        status: delivery.status,
        attemptCount: delivery.attemptCount,
        errorSanitized: delivery.errorSanitized,
        sentAt: delivery.sentAt,
        createdAt: delivery.createdAt,
      })),
    };
  }
}
