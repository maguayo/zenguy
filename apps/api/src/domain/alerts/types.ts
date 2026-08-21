import type { ChannelType } from "../channels/types";
import type { PaidAlertKind } from "./pricing";

export const DEFAULT_DAILY_PAID_ALERT_LIMIT = 20;
export const MIN_DAILY_PAID_ALERT_LIMIT = 1;
export const MAX_DAILY_PAID_ALERT_LIMIT = 200;
/** Below this balance the owner is told once that credit is running low. */
export const LOW_BALANCE_THRESHOLD_CENTS = 200;
/** One top-up pack, in euro cents. Top-ups buy whole packs. */
export const ALERT_CREDIT_PACK_CENTS = 1_000;
export const ALERT_CREDIT_MIN_PACKS = 1;
export const ALERT_CREDIT_MAX_PACKS = 10;
export const DEFAULT_EMAIL_CHANNEL_NAME = "Workspace email";

export interface AlertSettings {
  workspaceId: string;
  paidChannelsEnabled: boolean;
  dailyPaidAlertLimit: number;
  defaultEmailChannelCreatedAt: number | null;
  lowBalanceNotifiedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export function defaultAlertSettings(
  workspaceId: string,
  at: number,
): AlertSettings {
  return {
    workspaceId,
    paidChannelsEnabled: false,
    dailyPaidAlertLimit: DEFAULT_DAILY_PAID_ALERT_LIMIT,
    defaultEmailChannelCreatedAt: null,
    lowBalanceNotifiedAt: null,
    createdAt: at,
    updatedAt: at,
  };
}

export type AlertCreditEntryKind =
  | "TOPUP"
  | "GRANT"
  | "CHARGE"
  | "REFUND"
  | "ADJUSTMENT";

export interface AlertCreditEntry {
  id: string;
  workspaceId: string;
  kind: AlertCreditEntryKind;
  /** Signed amount: charges are negative. */
  amountCents: number;
  balanceAfterCents: number;
  deliveryId: string | null;
  providerTransactionId: string | null;
  description: string;
  idempotencyKey: string;
  createdAt: number;
}

const PAID_CHANNEL_TYPES: ReadonlySet<ChannelType> = new Set<ChannelType>([
  "SMS",
  "CALL",
  "WHATSAPP",
]);

export function isPaidChannelType(type: ChannelType): boolean {
  return PAID_CHANNEL_TYPES.has(type);
}

/** WhatsApp is priced like an SMS to the same destination. */
export function paidAlertKind(type: ChannelType): PaidAlertKind {
  return type === "CALL" ? "CALL" : "SMS";
}

export type PaidAlertsPauseReason = "PAID_OFF" | "NO_CREDIT";
