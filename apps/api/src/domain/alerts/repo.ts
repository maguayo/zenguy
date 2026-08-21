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
  at: number;
}

export interface LedgerWrite {
  entry: AlertCreditEntry;
  /** False when the idempotency key had already been written. */
  created: boolean;
}

export interface WorkspaceNeedingDefaultChannel {
  workspaceId: string;
  ownerUserId: string;
  ownerEmail: string;
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
  credit(input: CreditCreditInput): Promise<LedgerWrite>;
  findEntryByIdempotencyKey(key: string): Promise<AlertCreditEntry | null>;
  countCharges(workspaceId: string, since: number): Promise<number>;
  listEntries(
    workspaceId: string,
    cursor: Cursor | null | undefined,
    limit: number,
  ): Promise<AlertCreditEntry[]>;
  listWorkspacesNeedingDefaultChannel(
    limit: number,
  ): Promise<WorkspaceNeedingDefaultChannel[]>;
}
