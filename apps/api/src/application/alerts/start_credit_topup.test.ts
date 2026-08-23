import type { PaddleConfig } from "../../shared/config";
import { FixedClock } from "../../shared/clock";
import { FakeTrackEvent } from "../../test/fakes/activity";
import { testUser } from "../../test/fakes/auth";
import { FakeIds } from "../../test/fakes/ids";
import { FakePaddleCheckoutIntentRepo } from "../../test/fakes/paddle_checkout_intents";
import { IssuePaddleCheckoutIntent } from "../billing/paddle_checkout_intent";
import { StartCreditTopUp } from "./start_credit_topup";

const PADDLE: PaddleConfig = {
  apiKey: "api",
  webhookSecret: "webhook-secret",
  clientToken: "client",
  environment: "sandbox",
  productId: "pro_monthly",
  priceId: "pri_monthly",
  overagePriceId: "pri_overage",
  alertCreditProductId: "pro_alert_credit",
  alertCreditPriceId: "pri_alert_credit",
  apiBase: "https://sandbox-api.paddle.com",
};

function useCase(paddle: PaddleConfig | null = PADDLE) {
  const repo = new FakePaddleCheckoutIntentRepo();
  return {
    repo,
    value: new StartCreditTopUp(
      new IssuePaddleCheckoutIntent(
        repo,
        paddle,
        new FixedClock(1_000),
        new FakeIds(),
      ),
    ),
  };
}

describe("StartCreditTopUp", () => {
  it("returns signed, server-pinned checkout data for the owner", async () => {
    const { repo, value } = useCase();
    const actor = testUser();
    const checkout = await value.execute({
      workspaceId: "ws_1",
      actor,
      actorRole: "OWNER",
      packs: 3,
    });
    expect(checkout).toMatchObject({
      priceId: "pri_alert_credit",
      quantity: 3,
      amountCents: 3_000,
      currencyCode: "EUR",
      customData: {
        checkout_intent_id: "pci_00000000000000000000000001",
      },
    });
    expect(checkout.customData.checkout_intent_sig).not.toHaveLength(0);
    await expect(
      repo.findById(checkout.customData.checkout_intent_id),
    ).resolves.toMatchObject({
      workspaceId: "ws_1",
      actorUserId: actor.id,
      purpose: "alert_credit",
      productId: "pro_alert_credit",
      priceId: "pri_alert_credit",
      quantity: 3,
      amountCents: 3_000,
      consumedAt: null,
    });
  });

  it("rejects non-owners and invalid pack counts", async () => {
    const { value } = useCase();
    const actor = testUser();
    await expect(
      value.execute({ workspaceId: "ws_1", actor, actorRole: "ADMIN", packs: 1 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const packs of [0, 11, 1.5]) {
      await expect(
        value.execute({ workspaceId: "ws_1", actor, actorRole: "OWNER", packs }),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    }
  });

  it("is unavailable until Paddle is configured", async () => {
    const { value } = useCase(null);
    await expect(
      value.execute({
        workspaceId: "ws_1",
        actor: testUser(),
        actorRole: "OWNER",
        packs: 1,
      }),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("issues subscription intents only when no provider subscription is bound", async () => {
    const actor = testUser();
    const repo = new FakePaddleCheckoutIntentRepo();
    const available = new IssuePaddleCheckoutIntent(
      repo,
      PADDLE,
      new FixedClock(1_000),
      new FakeIds(),
      { findByWorkspace: async () => null },
    );
    await expect(
      available.execute({
        workspaceId: "ws_1",
        actor,
        actorRole: "OWNER",
        purpose: "subscription",
      }),
    ).resolves.toMatchObject({
      priceId: "pri_monthly",
      quantity: 1,
      amountCents: 3_900,
    });

    const alreadyBound = new IssuePaddleCheckoutIntent(
      new FakePaddleCheckoutIntentRepo(),
      PADDLE,
      new FixedClock(1_000),
      new FakeIds(),
      {
        findByWorkspace: async () => ({
          id: "sub_1",
          workspaceId: "ws_1",
          provider: "paddle",
          source: "paddle",
          providerCustomerId: "ctm_1",
          providerSubscriptionId: "sub_provider",
          status: "ACTIVE",
          periodStart: null,
          periodEnd: null,
          cancelAtPeriodEnd: false,
          updatePaymentUrl: null,
          cancelUrl: null,
          createdAt: 1,
          updatedAt: 1,
        }),
      },
    );
    await expect(
      alreadyBound.execute({
        workspaceId: "ws_1",
        actor,
        actorRole: "OWNER",
        purpose: "subscription",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("StartCreditTopUp activity", () => {
  function tracked(track: FakeTrackEvent, trackIntent = false) {
    return new StartCreditTopUp(
      new IssuePaddleCheckoutIntent(
        new FakePaddleCheckoutIntentRepo(),
        PADDLE,
        new FixedClock(1_000),
        new FakeIds(),
        undefined,
        trackIntent ? track : undefined,
      ),
      track,
    );
  }

  it("records alerts.topup_started with the checkout amount", async () => {
    const track = new FakeTrackEvent();
    const actor = testUser();

    await tracked(track).execute({
      workspaceId: "ws_1",
      actor,
      actorRole: "OWNER",
      packs: 3,
    });

    expect(track.calls).toEqual([
      {
        type: "alerts.topup_started",
        userId: actor.id,
        workspaceId: "ws_1",
        source: "server",
        properties: { amountCents: 3_000 },
      },
    ]);
  });

  it("emits the checkout event first when the intent issuer is tracked too", async () => {
    const track = new FakeTrackEvent();

    await tracked(track, true).execute({
      workspaceId: "ws_1",
      actor: testUser(),
      actorRole: "OWNER",
      packs: 1,
    });

    expect(track.calls.map((call) => call.type)).toEqual([
      "billing.checkout_started",
      "alerts.topup_started",
    ]);
    expect(track.ofType("billing.checkout_started")[0]?.properties).toEqual({
      kind: "alert_credit",
    });
  });

  it("records nothing when the top-up is refused", async () => {
    const track = new FakeTrackEvent();

    await expect(
      tracked(track).execute({
        workspaceId: "ws_1",
        actor: testUser(),
        actorRole: "OWNER",
        packs: 0,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(track.calls).toEqual([]);
  });
});
