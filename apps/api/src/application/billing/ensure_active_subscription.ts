import type { SubscriptionRepo } from "../../domain/billing/repo";
import { AppError } from "../../shared/errors";

export async function ensureActiveSubscription(
  subscriptions: SubscriptionRepo,
  workspaceId: string,
): Promise<void> {
  const subscription = await subscriptions.findByWorkspace(workspaceId);
  if (
    subscription?.status !== "ACTIVE" &&
    subscription?.status !== "PAST_DUE"
  ) {
    throw new AppError(
      "BILLING_REQUIRED",
      "This workspace needs an active subscription",
    );
  }
}
