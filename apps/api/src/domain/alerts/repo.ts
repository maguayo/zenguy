import type { Cursor } from "../../shared/pagination";
import type {
  AlertCreditEntry,
  AlertCreditEntryKind,
  AlertSettings,
} from "./types";

export interface AlertSettingsUpdate {
  paidChannelsEnabled?: boolean;
  dailyPaidAlertLimit?: number;
  defaultEmailChannelCreatedAt?: number | null;
  defaultPushChannelCreatedAt?: number | null;
  lowBalanceNotifiedAt?: number | null;
}

export interface CreditDebitInput {
  id: string;
  workspaceId: string;
  /** Positive amount to subtract. */
  amountCents: number;
  idempotencyKey: string;
  description: string;
  deliveryId: string | null;
  at: number;
}

export interface CreditCreditInput {
  id: string;
  workspaceId: string;
  /** Positive amount to add. */
  amountCents: number;
  kind: Exclude<AlertCreditEntryKind, "CHARGE">;
  idempotencyKey: string;
  description: string;
  deliveryId: string | null;
  providerTransactionId: string | null;
  /** Customer pinned from a verified provider transaction; null otherwise. */
  providerCustomerId?: string | null;
  at: number;
}

export interface CreditAdjustmentInput {
  id: string;
  workspaceId: string;
  /** Signed amount. Negative values represent refunds/chargebacks of credit. */
  amountCents: number;
  idempotencyKey: string;
  description: string;
  providerTransactionId: string;
  at: number;
}

export interface LedgerWrite {
  entry: AlertCreditEntry;
  /** False when the idempotency key had already been written. */
  created: boolean;
}

export type LimitedDebitResult =
  | { status: "written"; write: LedgerWrite }
  | { status: "daily_limit" }
  | { status: "insufficient_credit" };

export interface WorkspaceNeedingDefaultChannel {
  workspaceId: string;
  ownerUserId: string;
  ownerEmail: string;
}

export interface PaddleTopupForReconciliation {
  workspaceId: string;
  providerTransactionId: string;
  /** Null only for a legacy top-up that predates customer pinning. */
  providerCustomerId: string | null;
  amountCents: number;
}

export interface AlertRepo {
  findSettings(workspaceId: string): Promise<AlertSettings | null>;
  insertSettings(settings: AlertSettings): Promise<void>;
  updateSettings(
    workspaceId: string,
    changes: AlertSettingsUpdate,
    at: number,
  ): Promise<void>;
  getBalanceCents(workspaceId: string): Promise<number>;
  /**
   * Atomically debits the balance when it covers the amount. Returns null when
   * the balance is insufficient. Replaying the same idempotency key returns
   * the original entry without debiting again.
   */
  debit(input: CreditDebitInput): Promise<LedgerWrite | null>;
  /**
   * Atomically enforces both the prepaid balance and the rolling paid-alert
   * limit while writing the charge. Refunded deliveries do not consume a
   * daily-limit slot. Replays return the original ledger entry.
   */
  debitWithinDailyLimit(
    input: CreditDebitInput,
    dailyLimit: number,
    since: number,
  ): Promise<LimitedDebitResult>;
  credit(input: CreditCreditInput): Promise<LedgerWrite>;
  /**
   * Returns null when a debit exceeds its top-up or a reversal exceeds the
   * outstanding provider debits for that transaction.
   */
  adjust(input: CreditAdjustmentInput): Promise<LedgerWrite | null>;
  findEntryByIdempotencyKey(key: string): Promise<AlertCreditEntry | null>;
  findTopupByProviderTransactionId(
    id: string,
  ): Promise<PaddleTopupForReconciliation | null>;
  listTopupsNeedingReconciliation(
    reconciledBefore: number,
    limit: number,
  ): Promise<PaddleTopupForReconciliation[]>;
  markTopupReconciled(providerTransactionId: string, at: number): Promise<void>;
  countCharges(workspaceId: string, since: number): Promise<number>;
  listEntries(
    workspaceId: string,
    cursor: Cursor | null | undefined,
    limit: number,
  ): Promise<AlertCreditEntry[]>;
  listWorkspacesNeedingDefaultChannel(
    limit: number,
  ): Promise<WorkspaceNeedingDefaultChannel[]>;
  listWorkspaceIdsNeedingDefaultPushChannel(limit: number): Promise<string[]>;
}
