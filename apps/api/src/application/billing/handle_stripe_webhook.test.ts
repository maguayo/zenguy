import { WriteAudit } from "../audit/write_audit";
import { HandleStripeWebhook } from "./handle_stripe_webhook";
import type { PeriodOverageReporter } from "./handle_paddle_webhook";
import { FixedClock } from "../../shared/clock";
import { hmacSha256Hex } from "../../shared/crypto";
import { FakeAlertRepo } from "../../test/fakes/alerts";
import { FakeIds } from "../../test/fakes/ids";
import { FakeKv } from "../../test/fakes/kv";
import { FakePaddleCheckoutIntentRepo } from "../../test/fakes/paddle_checkout_intents";
import {
  FakeAuditRepo,
  FakePendingOveragePeriodRepo,
  FakeSubscriptionRepo,
} from "../../test/fakes/repos";

const NOW = Date.parse("2026-09-01T00:05:00Z");
const SIGNING_SECRET = "whsec_test_secret";
const noopReporter: PeriodOverageReporter = { execute: async () => undefined };

function setup() {
  const clock = new FixedClock(NOW);
  const alerts = new FakeAlertRepo();
  const audits = new FakeAuditRepo();
  const checkoutIntents = new FakePaddleCheckoutIntentRepo();
  const subscriptions = new FakeSubscriptionRepo();
  const handler = new HandleStripeWebhook({
    webhookSecret: SIGNING_SECRET,
    kv: new FakeKv(clock),
    subscriptions,
    checkoutIntents,
    workspaces: {
      findById: async (id: string) =>
        id === "ws_1"
          ? {
              id,
              name: "Workspace",
              slug: "workspace",
              timezone: "UTC",
              ownerUserId: "usr_owner",
              createdAt: 1,
              updatedAt: 1,
              deletedAt: null,
            }
          : null,
    },
    pendingOveragePeriods: new FakePendingOveragePeriodRepo(),
    overageReporter: noopReporter,
    audit: new WriteAudit({ audits, clock, ids: new FakeIds() }),
    clock,
    ids: new FakeIds(),
    alerts,
    alertCreditProductId: "prod_alert",
    alertCreditPriceId: "price_alert",
    subscriptionProductId: "prod_monthly",
    subscriptionPriceId: "price_monthly",
  });
  return { handler, alerts, audits, checkoutIntents, subscriptions };
}

async function deliver(handler: HandleStripeWebhook, payload: unknown) {
  const rawBody = JSON.stringify(payload);
  const timestamp = NOW / 1_000;
  const signature = await hmacSha256Hex(
    SIGNING_SECRET,
    `${timestamp}.${rawBody}`,
  );
  return handler.execute({
    rawBody,
    signatureHeader: `t=${timestamp},v1=${signature}`,
    ip: "203.0.113.9",
  });
}

function event(type: string, object: unknown, id = `evt_${type}`) {
  return {
    id,
    type,
    created: NOW / 1_000 - 1,
    data: { object },
  };
}

function topupSession() {
  return {
    id: "cs_test_topup",
    mode: "payment",
    payment_status: "paid",
    client_reference_id: "pci_topup",
    customer: "cus_1",
    payment_intent: "pi_1",
    currency: "eur",
    amount_subtotal: 2_000,
    metadata: {
      checkout_intent_id: "pci_topup",
      purpose: "alert_credit",
    },
  };
}

function subscription(status = "active") {
  return {
    id: "sub_1",
    customer: "cus_1",
    status,
    metadata: {
      checkout_intent_id: "pci_subscription",
      purpose: "subscription",
    },
    items: {
      data: [{
        quantity: 1,
        current_period_start: 1_777_593_600,
        current_period_end: 1_780_272_000,
        price: {
          id: "price_monthly",
          product: "prod_monthly",
          currency: "eur",
          unit_amount: 3_900,
          recurring: { interval: "month" },
        },
      }],
    },
    cancel_at_period_end: false,
    cancel_at: null,
  };
}

describe("HandleStripeWebhook", () => {
  it("credits a paid top-up exactly once from a signed Checkout event", async () => {
    const { handler, alerts, checkoutIntents } = setup();
    checkoutIntents.intents.set("pci_topup", {
      id: "pci_topup",
      workspaceId: "ws_1",
      actorUserId: "usr_owner",
      purpose: "alert_credit",
      productId: "prod_alert",
      priceId: "price_alert",
      quantity: 2,
      currencyCode: "EUR",
      amountCents: 2_000,
      createdAt: NOW - 1_000,
      expiresAt: NOW + 60_000,
      consumedAt: null,
      providerReference: null,
    });

    await expect(
      deliver(handler, event("checkout.session.completed", topupSession())),
    ).resolves.toEqual({ handled: "processed" });
    await expect(
      deliver(
        handler,
        event(
          "checkout.session.completed",
          topupSession(),
          "evt_checkout_redelivery",
        ),
      ),
    ).resolves.toEqual({ handled: "processed" });
    expect(await alerts.getBalanceCents("ws_1")).toBe(2_000);
    expect(alerts.entries).toHaveLength(1);
    expect(alerts.entries[0]).toMatchObject({
      idempotencyKey: "stripe_pi:pi_1",
      providerTransactionId: "pi_1",
      amountCents: 2_000,
    });
  });

  it("applies succeeded refunds and reverses won disputes idempotently", async () => {
    const { handler, alerts, checkoutIntents } = setup();
    checkoutIntents.intents.set("pci_topup", {
      id: "pci_topup",
      workspaceId: "ws_1",
      actorUserId: "usr_owner",
      purpose: "alert_credit",
      productId: "prod_alert",
      priceId: "price_alert",
      quantity: 2,
      currencyCode: "EUR",
      amountCents: 2_000,
      createdAt: NOW - 1_000,
      expiresAt: NOW + 60_000,
      consumedAt: null,
      providerReference: null,
    });
    await deliver(handler, event("checkout.session.completed", topupSession()));
    await deliver(handler, event("refund.updated", {
      id: "re_1",
      status: "succeeded",
      payment_intent: "pi_1",
      amount: 400,
      currency: "eur",
    }));
    await deliver(handler, event("charge.dispute.created", {
      id: "dp_1",
      status: "needs_response",
      payment_intent: "pi_1",
      amount: 500,
      currency: "eur",
    }));
    await deliver(handler, event("charge.dispute.closed", {
      id: "dp_1",
      status: "won",
      payment_intent: "pi_1",
      amount: 500,
      currency: "eur",
    }));

    expect(await alerts.getBalanceCents("ws_1")).toBe(1_600);
    expect(alerts.entries.map(({ idempotencyKey }) => idempotencyKey)).toEqual([
      "stripe_pi:pi_1",
      "stripe_refund:re_1:succeeded",
      "stripe_dispute:dp_1:debit",
      "stripe_dispute:dp_1:won",
    ]);
  });

  it("binds the catalog-pinned subscription and rejects stale updates", async () => {
    const { handler, checkoutIntents, subscriptions } = setup();
    checkoutIntents.intents.set("pci_subscription", {
      id: "pci_subscription",
      workspaceId: "ws_1",
      actorUserId: "usr_owner",
      purpose: "subscription",
      productId: "prod_monthly",
      priceId: "price_monthly",
      quantity: 1,
      currencyCode: "EUR",
      amountCents: 3_900,
      createdAt: NOW - 1_000,
      expiresAt: NOW + 60_000,
      consumedAt: null,
      providerReference: null,
    });

    await deliver(
      handler,
      event("customer.subscription.created", subscription()),
    );
    await expect(subscriptions.findByWorkspace("ws_1")).resolves.toMatchObject({
      provider: "stripe",
      source: "stripe",
      providerCustomerId: "cus_1",
      providerSubscriptionId: "sub_1",
      status: "ACTIVE",
    });

    const stale = event(
      "customer.subscription.updated",
      subscription("past_due"),
      "evt_stale",
    );
    stale.created = NOW / 1_000 - 10;
    await expect(deliver(handler, stale)).resolves.toEqual({ handled: "ignored" });
    await expect(subscriptions.findByWorkspace("ws_1")).resolves.toMatchObject({
      status: "ACTIVE",
    });
  });

  it("rejects an invalid Stripe signature before parsing or writing", async () => {
    const { handler, alerts } = setup();
    await expect(handler.execute({
      rawBody: JSON.stringify(event("checkout.session.completed", topupSession())),
      signatureHeader: `t=${NOW / 1_000},v1=${"0".repeat(64)}`,
    })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(alerts.entries).toEqual([]);
  });
});
