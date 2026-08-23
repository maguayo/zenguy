import type { BillingCanceller } from "../../domain/billing/canceller";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import type { Clock } from "../../shared/clock";
import { systemClock } from "../../shared/clock";
import type { PaddleClient } from "./client";

export class PaddleBillingCanceller implements BillingCanceller {
  constructor(
    private readonly subscriptions: SubscriptionRepo,
    private readonly paddle: PaddleClient,
    private readonly clock: Clock = systemClock,
  ) {}

  async cancelForWorkspace(workspaceId: string): Promise<void> {
    const subscription = await this.subscriptions.findByWorkspace(workspaceId);
    if (subscription === null) return;
    // The deletion saga may be redelivered after the local commit (or after a
    // subscription.canceled webhook). Never issue a second provider mutation
    // once local state proves cancellation completed.
    if (subscription.status === "CANCELED") return;

    if (subscription.providerSubscriptionId !== null) {
      await this.paddle.cancelSubscription(
        subscription.providerSubscriptionId,
      );
    }
    await this.subscriptions.upsertByWorkspace({
      ...subscription,
      status: "CANCELED",
      updatedAt: this.clock.now(),
    });
  }
}
