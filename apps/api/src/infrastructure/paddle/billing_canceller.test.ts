import type { Subscription } from "../../domain/billing/types";
import { FixedClock } from "../../shared/clock";
import { RecordingPaddleClient } from "../../test/fakes/billing";
import { FakeSubscriptionRepo } from "../../test/fakes/repos";
import { PaddleBillingCanceller } from "./billing_canceller";

const SUBSCRIPTION: Subscription = {
  id: "sub_local",
  workspaceId: "ws_123",
  provider: "paddle",
  providerCustomerId: "ctm_123",
  providerSubscriptionId: "sub_provider",
  status: "ACTIVE",
  periodStart: 1_000,
  periodEnd: 2_000,
  cancelAtPeriodEnd: false,
  updatePaymentUrl: "https://paddle.test/update",
  cancelUrl: "https://paddle.test/cancel",
  createdAt: 900,
  updatedAt: 1_000,
};

describe("PaddleBillingCanceller", () => {
  it("cancels the provider subscription then updates local status", async () => {
    const subscriptions = new FakeSubscriptionRepo();
    await subscriptions.upsertByWorkspace(SUBSCRIPTION);
    const paddle = new RecordingPaddleClient();
    const canceller = new PaddleBillingCanceller(
      subscriptions,
      paddle,
      new FixedClock(3_000),
    );

    await canceller.cancelForWorkspace(SUBSCRIPTION.workspaceId);

    expect(paddle.cancellations).toEqual(["sub_provider"]);
    await expect(
      subscriptions.findByWorkspace(SUBSCRIPTION.workspaceId),
    ).resolves.toEqual({
      ...SUBSCRIPTION,
      status: "CANCELED",
      updatedAt: 3_000,
    });
  });

  it("still cancels locally when no provider subscription exists", async () => {
    const subscriptions = new FakeSubscriptionRepo();
    await subscriptions.upsertByWorkspace({
      ...SUBSCRIPTION,
      providerSubscriptionId: null,
    });
    const paddle = new RecordingPaddleClient();
    const canceller = new PaddleBillingCanceller(
      subscriptions,
      paddle,
      new FixedClock(3_000),
    );

    await canceller.cancelForWorkspace(SUBSCRIPTION.workspaceId);

    expect(paddle.cancellations).toEqual([]);
    await expect(
      subscriptions.findByWorkspace(SUBSCRIPTION.workspaceId),
    ).resolves.toMatchObject({ status: "CANCELED", updatedAt: 3_000 });
  });

  it("does nothing when the workspace has no local subscription", async () => {
    const subscriptions = new FakeSubscriptionRepo();
    const paddle = new RecordingPaddleClient();
    const canceller = new PaddleBillingCanceller(subscriptions, paddle);

    await canceller.cancelForWorkspace("ws_missing");

    expect(paddle.cancellations).toEqual([]);
    expect(subscriptions.subscriptions.size).toBe(0);
  });
});
