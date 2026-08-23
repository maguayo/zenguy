import type { SubscriptionRepo } from "../../domain/billing/repo";
import type { Subscription } from "../../domain/billing/types";
import { PAST_DUE_GRACE_DAYS } from "../../shared/constants";
import { AppError } from "../../shared/errors";

const PAST_DUE_GRACE_MS = PAST_DUE_GRACE_DAYS * 86_400_000;

export function subscriptionAllowsExecution(
  subscription: Subscription | null,
  now: number,
): boolean {
  if (subscription?.status === "ACTIVE") return true;
  return (
    subscription?.status === "PAST_DUE" &&
    (subscription.pastDueSince ?? subscription.updatedAt) + PAST_DUE_GRACE_MS >
      now
  );
}

export async function ensureActiveSubscription(
  subscriptions: SubscriptionRepo,
  workspaceId: string,
  now = Date.now(),
): Promise<void> {
  const subscription = await subscriptions.findByWorkspace(workspaceId);
  if (!subscriptionAllowsExecution(subscription, now)) {
    throw new AppError(
      "BILLING_REQUIRED",
      "This workspace needs an active subscription",
    );
  }
}
