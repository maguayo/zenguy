export interface IncidentNotificationEvent {
  workspaceId: string;
  incidentId: string;
  type: "NOTIFICATION_SENT" | "NOTIFICATION_FAILED";
  channelId: string;
  channelName: string;
  deliveryId: string;
  status: "SENT" | "FAILED";
}

export interface IncidentEventWriter {
  write(event: IncidentNotificationEvent): Promise<void>;
}

export class NoopIncidentEventWriter implements IncidentEventWriter {
  async write(_event: IncidentNotificationEvent): Promise<void> {}
}
