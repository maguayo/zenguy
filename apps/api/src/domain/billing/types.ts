export type SubscriptionStatus =
  | "NONE"
  | "ACTIVE"
  | "PAST_DUE"
  | "CANCELED";

export interface Subscription {
  id: string;
  workspaceId: string;
  provider: "paddle";
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
  status: SubscriptionStatus;
  periodStart: number | null;
  periodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  updatePaymentUrl: string | null;
  cancelUrl: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface UsageEvent {
  id: string;
  workspaceId: string;
  testRunId: string;
  type: "BROWSER_RUN";
  quantity: number;
  billable: boolean;
  idempotencyKey: string;
  occurredAt: number;
  reversedAt: number | null;
  createdAt: number;
}

export interface OverageReport {
  id: string;
  workspaceId: string;
  periodStart: number;
  periodEnd: number;
  overageRuns: number;
  amountCents: number;
  paddleTransactionId: string | null;
  reportedAt: number;
}
