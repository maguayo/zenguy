import type {
  IncidentEventWriter,
  IncidentNotificationEvent,
} from "../channels/incident_event_writer";
import type {
  IncidentEventRepo,
  IncidentRepo,
} from "../../domain/incidents/repo";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/ids";
import { truncate } from "../../shared/redact";

export class WriteIncidentNotificationEvent implements IncidentEventWriter {
  constructor(
    private readonly incidents: Pick<IncidentRepo, "findById" | "touch">,
    private readonly events: IncidentEventRepo,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async write(input: IncidentNotificationEvent): Promise<void> {
    const incident = await this.incidents.findById(
      input.workspaceId,
      input.incidentId,
    );
    if (incident === null) return;
    const now = this.clock.now();
    await this.events.insert({
      id: this.ids.newId("evt"),
      incidentId: incident.id,
      type: input.type,
      sourceId: input.deliveryId,
      message: truncate(
        input.detail === undefined
          ? `Notification via ${input.channelName}: ${input.status}`
          : `Notification via ${input.channelName}: ${input.status} — ${input.detail}`,
        2_000,
      ),
      metadataJson: JSON.stringify({
        channelId: input.channelId,
        channelName: input.channelName,
        deliveryId: input.deliveryId,
        status: input.status,
        ...(input.detail === undefined ? {} : { detail: input.detail }),
      }),
      createdAt: now,
    });
    await this.incidents.touch(incident.id, now);
  }
}
