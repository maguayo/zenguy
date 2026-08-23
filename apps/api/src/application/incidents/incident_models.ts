import type {
  ChannelType,
  DeliveryEventType,
  DeliveryStatus,
} from "../../domain/channels/types";
import type {
  IncidentEventType,
  IncidentResourceType,
  IncidentStatus,
} from "../../domain/incidents/types";

export interface IncidentListItemOutput {
  id: string;
  resourceType: IncidentResourceType;
  resourceId: string;
  resourceName: string;
  status: IncidentStatus;
  openedAt: number;
  resolvedAt: number | null;
  durationMs: number;
  lastEventAt: number;
}

export interface IncidentEventOutput {
  id: string;
  type: IncidentEventType;
  message: string;
  metadata: Record<string, unknown> | null;
  createdAt: number;
}

export interface IncidentDeliveryOutput {
  id: string;
  channelName: string;
  channelType: ChannelType | null;
  eventType: DeliveryEventType;
  status: DeliveryStatus | "AMBIGUOUS";
  attemptCount: number;
  errorSanitized: string | null;
  sentAt: number | null;
  createdAt: number;
  costCents: number | null;
  destinationCountry: string | null;
}

export interface IncidentDetailOutput extends IncidentListItemOutput {
  openedByRunId: string | null;
  openedByCheckId: string | null;
  events: IncidentEventOutput[];
  deliveries: IncidentDeliveryOutput[];
}
