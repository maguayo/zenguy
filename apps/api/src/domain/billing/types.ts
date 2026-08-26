export type SubscriptionStatus =
  | "NONE"
  | "ACTIVE"
  | "PAST_DUE"
  | "CANCELED";

export type SubscriptionProvider = "internal" | "paddle" | "stripe";
export type SubscriptionSource = "free" | "grant" | "paddle" | "stripe";

export interface Subscription {
  id: string;
  workspaceId: string;
  provider: SubscriptionProvider;
  source?: SubscriptionSource;
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
  /** First transition into the current PAST_DUE state; never extended by later webhooks. */
  pastDueSince?: number | null;
  /** Provider event time used to reject stale/out-of-order billing webhooks. */
  lastProviderEventAt?: number | null;
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
  state: "PENDING" | "AMBIGUOUS" | "COMPLETED";
  providerMarker: string | null;
  attemptStartedAt: number | null;
  completedAt: number | null;
  /** Provider subscription pinned before the first external charge attempt. */
  providerSubscriptionId: string | null;
}

export interface PendingOveragePeriod {
  workspaceId: string;
  periodStart: number;
  periodEnd: number;
  createdAt: number;
  /** Provider subscription that owned this billing period at rollover time. */
  providerSubscriptionId: string | null;
  nextAttemptAt: number;
  attemptCount: number;
}

export interface SubscriptionGrant {
  id: string;
  tokenHash: string;
  issuedByUserId: string;
  note: string | null;
  expiresAt: number;
  redeemedAt: number | null;
  redeemedWorkspaceId: string | null;
  createdAt: number;
}

export type CheckoutPurpose = "subscription" | "alert_credit";

export interface CheckoutIntent {
  id: string;
  workspaceId: string;
  actorUserId: string;
  purpose: CheckoutPurpose;
  productId: string;
  priceId: string;
  quantity: number;
  currencyCode: "EUR";
  amountCents: number;
  createdAt: number;
  expiresAt: number;
  consumedAt: number | null;
  providerReference: string | null;
}

/** @deprecated Kept for historical Paddle rows and tests. */
export type PaddleCheckoutPurpose = CheckoutPurpose;
/** @deprecated Kept for historical Paddle rows and tests. */
export type PaddleCheckoutIntent = CheckoutIntent;

export function isComplimentarySubscription(
  subscription: Pick<Subscription, "source" | "providerSubscriptionId"> | null,
): boolean {
  if (subscription === null) return false;
  return (
    subscription.source === "free" ||
    subscription.source === "grant" ||
    subscription.providerSubscriptionId === null
  );
}
