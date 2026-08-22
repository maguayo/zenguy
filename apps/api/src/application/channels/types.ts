import { alertUnitCents, quoteFor } from "../../domain/alerts/pricing";
import {
  isPaidChannelType,
  paidAlertKind,
  type PaidAlertsPauseReason,
} from "../../domain/alerts/types";
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
import type { PushReach } from "../../domain/push/repo";
import { decryptSecret } from "../../shared/crypto";
import { phoneNumberOf } from "../alerts/charge_paid_delivery";
import type { PaidChannelContext } from "../alerts/settings";

export interface ChannelPrice {
  cents: number;
  currency: "EUR";
  destination: string;
}

export interface ChannelOutput {
  id: string;
  name: string;
  type: ChannelType;
  enabled: boolean;
  isDefault: boolean;
  configPreview: ChannelConfigPreview;
  /** Price per alert for pay-as-you-go channels; null for free channels. */
  price: ChannelPrice | null;
  /** Why a pay-as-you-go channel currently cannot deliver; null when it can. */
  paused: { reason: PaidAlertsPauseReason } | null;
  /** Devices and members a mobile push channel currently reaches. */
  reach: PushReach | null;
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
  costCents: number | null;
  destinationCountry: string | null;
}

export function channelPrice(
  type: ChannelType,
  config: unknown,
): ChannelPrice | null {
  if (!isPaidChannelType(type)) return null;
  const quote = quoteFor(phoneNumberOf(config));
  return {
    cents: alertUnitCents(paidAlertKind(type), quote),
    currency: "EUR",
    destination: quote.destination.name,
  };
}

export function channelPause(
  price: ChannelPrice | null,
  paid: PaidChannelContext,
): { reason: PaidAlertsPauseReason } | null {
  if (price === null) return null;
  if (!paid.enabled) return { reason: "PAID_OFF" };
  if (paid.balanceCents < price.cents) return { reason: "NO_CREDIT" };
  return null;
}

export async function channelOutput(
  channel: NotificationChannel,
  encryptionKey: Uint8Array,
  paid: PaidChannelContext,
  reach: PushReach | null = null,
): Promise<ChannelOutput> {
  const plaintext = await decryptSecret(channel.encryptedConfig, encryptionKey);
  const config = channelConfigSchema(channel.type).parse(JSON.parse(plaintext));
  const price = channelPrice(channel.type, config);
  return {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    enabled: channel.enabled,
    isDefault: channel.isDefault === true,
    configPreview: configPreview(channel.type, config),
    price,
    paused: channelPause(price, paid),
    reach: channel.type === "PUSH" ? reach : null,
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
    costCents: delivery.costCents ?? null,
    destinationCountry: delivery.destinationCountry ?? null,
  };
}
