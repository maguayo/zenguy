import type { Cursor } from "../../shared/pagination";
import type {
  DeliveryStatus,
  IncidentNotificationDelivery,
  NotificationChannel,
  NotificationDelivery,
} from "./types";

export interface ChannelUpdate {
  name?: string;
  enabled?: boolean;
  isDefault?: boolean;
  encryptedConfig?: string;
}

export interface DeliveryUpdate {
  status: DeliveryStatus;
  providerMessageId?: string | null;
  errorSanitized?: string | null;
  attemptCount: number;
  sentAt?: number | null;
  costCents?: number | null;
  destinationCountry?: string | null;
}

export interface DeliveryDispatchClaim {
  delivery: NotificationDelivery;
  dispatchToken: string;
}

export interface ChannelRepo {
  insert(channel: NotificationChannel): Promise<void>;
  findById(
    workspaceId: string,
    id: string,
  ): Promise<NotificationChannel | null>;
  list(workspaceId: string): Promise<NotificationChannel[]>;
  listPage(
    workspaceId: string,
    cursor: Cursor | null | undefined,
    limit: number,
  ): Promise<NotificationChannel[]>;
  listByIds(
    workspaceId: string,
    ids: string[],
  ): Promise<NotificationChannel[]>;
  update(id: string, changes: ChannelUpdate, at: number): Promise<void>;
  setLastDeliveryStatus(id: string, status: string): Promise<void>;
  setVerified(id: string, at: number): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface DeliveryRepo {
  insert(delivery: NotificationDelivery): Promise<void>;
  findById(
    workspaceId: string,
    id: string,
  ): Promise<NotificationDelivery | null>;
  beginDispatch(
    workspaceId: string,
    id: string,
    dispatchToken: string,
    claimedAt: number,
    staleBefore: number,
  ): Promise<DeliveryDispatchClaim | null>;
  finishDispatch(
    id: string,
    dispatchToken: string,
    changes: DeliveryUpdate,
  ): Promise<boolean>;
  markDispatchAmbiguous(
    id: string,
    dispatchToken: string,
    attemptCount: number,
    errorSanitized: string,
  ): Promise<NotificationDelivery | null>;
  markStaleDispatchAmbiguous(
    workspaceId: string,
    id: string,
    staleBefore: number,
    errorSanitized: string,
  ): Promise<NotificationDelivery | null>;
  recordProviderAcceptance(
    id: string,
    providerIdempotencyKey: string,
    providerMessageId: string | null,
    sentAt: number,
  ): Promise<boolean>;
  update(id: string, changes: DeliveryUpdate): Promise<void>;
  listForChannel(
    channelId: string,
    cursor: Cursor | null | undefined,
    limit: number,
  ): Promise<NotificationDelivery[]>;
  listForIncident(incidentId: string): Promise<NotificationDelivery[]>;
  listForIncidentWithChannel(
    incidentId: string,
  ): Promise<IncidentNotificationDelivery[]>;
}
