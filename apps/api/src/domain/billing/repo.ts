import type {
  OverageReport,
  PendingOveragePeriod,
  CheckoutIntent,
  Subscription,
  SubscriptionGrant,
  UsageEvent,
} from "./types";

export type InsertResult = "inserted" | "duplicate";

export interface SubscriptionRepo {
  upsertByWorkspace(subscription: Subscription): Promise<void>;
  findByWorkspace(workspaceId: string): Promise<Subscription | null>;
  findByProviderSubscriptionId(id: string): Promise<Subscription | null>;
  listPeriodEnded(
    before: number,
    limit: number,
    after?: { periodEnd: number; id: string },
  ): Promise<Subscription[]>;
}

export type ConsumeCheckoutIntentResult =
  | "consumed"
  | "replayed"
  | "unavailable";

export interface CheckoutIntentRepo {
  insert(intent: CheckoutIntent): Promise<void>;
  findById(id: string): Promise<CheckoutIntent | null>;
  consume(
    id: string,
    providerReference: string,
    at: number,
  ): Promise<ConsumeCheckoutIntentResult>;
  purgeExpired(before: number): Promise<number>;
}

/** @deprecated Kept for the legacy Paddle adapter. */
export type PaddleCheckoutIntentRepo = CheckoutIntentRepo;

export interface UsageEventRepo {
  insertIfAbsent(event: UsageEvent): Promise<InsertResult>;
  findByRunId(runId: string): Promise<UsageEvent | null>;
  reverseByRunId(runId: string, at: number): Promise<void>;
  countBillable(
    workspaceId: string,
    fromMs: number,
    toMs: number,
  ): Promise<number>;
}

export interface OverageReportRepo {
  insertIfAbsent(report: OverageReport): Promise<InsertResult>;
  findFor(
    workspaceId: string,
    periodStart: number,
  ): Promise<OverageReport | null>;
  beginAttempt(
    id: string,
    at: number,
  ): Promise<boolean>;
  markCompleted(
    id: string,
    transactionId: string | null,
    at: number,
  ): Promise<void>;
}

export interface PendingOveragePeriodRepo {
  insertIfAbsent(period: PendingOveragePeriod): Promise<InsertResult>;
  list(limit: number): Promise<PendingOveragePeriod[]>;
  listReady(at: number, limit: number): Promise<PendingOveragePeriod[]>;
  rescheduleFor(
    workspaceId: string,
    periodStart: number,
    nextAttemptAt: number,
  ): Promise<void>;
  deleteFor(workspaceId: string, periodStart: number): Promise<void>;
}

export interface SubscriptionGrantRepo {
  insert(grant: SubscriptionGrant): Promise<void>;
  findByHash(hash: string): Promise<SubscriptionGrant | null>;
  findValidByHash(hash: string, now: number): Promise<SubscriptionGrant | null>;
  listByIssuer(userId: string): Promise<SubscriptionGrant[]>;
  consume(
    id: string,
    workspaceId: string,
    at: number,
  ): Promise<boolean>;
}
