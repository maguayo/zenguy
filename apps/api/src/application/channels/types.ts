import type {
  ChannelConfigPreview,
  ChannelType,
  DeliveryEventType,
  DeliveryStatus,
  NotificationChannel,
  NotificationDelivery,
} from "../../domain/channels/types";
import {
  channelConfigSchema,
  configPreview,
} from "../../domain/channels/types";
import { decryptSecret } from "../../shared/crypto";

export interface ChannelOutput {
  id: string;
  name: string;
  type: ChannelType;
  enabled: boolean;
  configPreview: ChannelConfigPreview;
  verifiedAt: number | null;
  lastDeliveryStatus: "SENT" | "FAILED" | null;
  createdAt: number;
}

export interface DeliveryOutput {
  id: string;
  eventType: DeliveryEventType;
  status: DeliveryStatus;
  providerMessageId: string | null;
  attemptCount: number;
  errorSanitized: string | null;
  sentAt: number | null;
  createdAt: number;
  incidentId: string | null;
}

export async function channelOutput(
  channel: NotificationChannel,
  encryptionKey: Uint8Array,
): Promise<ChannelOutput> {
  const plaintext = await decryptSecret(channel.encryptedConfig, encryptionKey);
  const config = channelConfigSchema(channel.type).parse(JSON.parse(plaintext));
  return {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    enabled: channel.enabled,
    configPreview: configPreview(channel.type, config),
    verifiedAt: channel.verifiedAt,
    lastDeliveryStatus:
      channel.lastDeliveryStatus === "SENT" ||
      channel.lastDeliveryStatus === "FAILED"
        ? channel.lastDeliveryStatus
        : null,
    createdAt: channel.createdAt,
  };
}

export function deliveryOutput(
  delivery: NotificationDelivery,
): DeliveryOutput {
  return {
    id: delivery.id,
    eventType: delivery.eventType,
    status: delivery.status,
    providerMessageId: delivery.providerMessageId,
    attemptCount: delivery.attemptCount,
    errorSanitized: delivery.errorSanitized,
    sentAt: delivery.sentAt,
    createdAt: delivery.createdAt,
    incidentId: delivery.incidentId,
  };
}
