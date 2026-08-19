import type {
  OverageReport,
  Subscription,
  UsageEvent,
} from "./types";

export type InsertResult = "inserted" | "duplicate";

export interface SubscriptionRepo {
  upsertByWorkspace(subscription: Subscription): Promise<void>;
  findByWorkspace(workspaceId: string): Promise<Subscription | null>;
  findByProviderSubscriptionId(id: string): Promise<Subscription | null>;
  listPeriodEnded(before: number, limit: number): Promise<Subscription[]>;
}

export interface UsageEventRepo {
  insertIfAbsent(event: UsageEvent): Promise<InsertResult>;
  reverseByRunId(runId: string, at: number): Promise<void>;
  countBillable(
    workspaceId: string,
    fromMs: number,
    toMs: number,
  ): Promise<number>;
}

export interface OverageReportRepo {
  insertIfAbsent(report: OverageReport): Promise<InsertResult>;
  existsFor(workspaceId: string, periodStart: number): Promise<boolean>;
}
