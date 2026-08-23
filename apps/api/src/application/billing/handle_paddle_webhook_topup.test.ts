import { WriteAudit } from "../audit/write_audit";
import type { PeriodOverageReporter } from "./handle_paddle_webhook";
import { HandlePaddleWebhook } from "./handle_paddle_webhook";
import { defaultAlertSettings } from "../../domain/alerts/types";
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
const SIGNING_SECRET = "pdl_webhook_test_secret";
const PRICE_ID = "pri_alert_credit";

const noopReporter: PeriodOverageReporter = { execute: async () => undefined };

function transaction(overrides: Record<string, unknown> = {}) {
  return {
    event_id: `evt_${String(overrides.event_id ?? "txn_1")}`,
    event_type: "transaction.completed",
    occurred_at: "2026-09-01T00:00:01Z",
    data: {
      id: "txn_1",
      customer_id: "ctm_1",
      currency_code: "EUR",
      status: "completed",
      custom_data: {
        checkout_intent_id: "pci_topup",
        checkout_intent_sig: "Zs80dTiA9HGMjF_pOF7V20n-Ocp8NcSKh7pUK5cqLPw",
      },
      items: [
        {
          price: {
            id: PRICE_ID,
            product_id: "pro_alert_credit",
            unit_price: { amount: "1000", currency_code: "EUR" },
          },
          quantity: 2,
        },
      ],
      details: {
        totals: { currency_code: "EUR", total: "2000" },
      },
      ...overrides,
    },
  };
}

function setup(options: { priceId?: string | null; alerts?: boolean } = {}) {
  const clock = new FixedClock(NOW);
  const alerts = new FakeAlertRepo();
  const audits = new FakeAuditRepo();
  const checkoutIntents = new FakePaddleCheckoutIntentRepo();
  checkoutIntents.intents.set("pci_topup", {
    id: "pci_topup",
    workspaceId: "ws_1",
    actorUserId: "usr_owner",
    purpose: "alert_credit",
    productId: "pro_alert_credit",
    priceId: PRICE_ID,
    quantity: 2,
    currencyCode: "EUR",
    amountCents: 2_000,
    createdAt: NOW - 1_000,
    expiresAt: NOW + 60_000,
    consumedAt: null,
    providerReference: null,
  });
  const handler = new HandlePaddleWebhook({
    webhookSecret: SIGNING_SECRET,
    kv: new FakeKv(clock),
    subscriptions: new FakeSubscriptionRepo(),
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
    ...(options.alerts === false ? {} : { alerts }),
    alertCreditProductId: "pro_alert_credit",
    alertCreditPriceId:
      options.priceId === undefined ? PRICE_ID : options.priceId,
    subscriptionProductId: "pro_monthly",
    subscriptionPriceId: "pri_monthly",
  });
  return { handler, alerts, audits, checkoutIntents };
}

async function deliver(handler: HandlePaddleWebhook, payload: unknown) {
  const rawBody = JSON.stringify(payload);
  const timestamp = NOW / 1_000;
  const h1 = await hmacSha256Hex(SIGNING_SECRET, `${timestamp}:${rawBody}`);
  return handler.execute({
    rawBody,
    signatureHeader: `ts=${timestamp};h1=${h1}`,
    ip: "203.0.113.9",
  });
}

describe("HandlePaddleWebhook alert-credit top-ups", () => {
  it("credits packs × €10, clears the low-balance notice, and audits it", async () => {
    const { handler, alerts, audits } = setup();
    alerts.settings.set("ws_1", {
      ...defaultAlertSettings("ws_1", 1),
      lowBalanceNotifiedAt: 5,
    });

    await expect(deliver(handler, transaction())).resolves.toEqual({
      handled: "processed",
    });
    expect(await alerts.getBalanceCents("ws_1")).toBe(2_000);
    expect(alerts.entries[0]).toMatchObject({
      kind: "TOPUP",
      amountCents: 2_000,
      providerTransactionId: "txn_1",
      idempotencyKey: "paddle_txn:txn_1",
      description: "Top-up (2 × €10)",
    });
    await expect(
      alerts.findTopupByProviderTransactionId("txn_1"),
    ).resolves.toMatchObject({ providerCustomerId: "ctm_1" });
    expect(alerts.settings.get("ws_1")?.lowBalanceNotifiedAt).toBeNull();
    const entries = await audits.list("ws_1", null, 10);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: "alerts.credit_topup",
      actorUserId: null,
      resourceId: "txn_1",
    });
  });

  it("never credits the same transaction twice, even under a new event id", async () => {
    const { handler, alerts } = setup();
    await deliver(handler, transaction());
    await expect(
      deliver(handler, transaction({ event_id: "txn_1_redelivered" })),
    ).resolves.toEqual({ handled: "processed" });
    expect(await alerts.getBalanceCents("ws_1")).toBe(2_000);
    expect(alerts.entries).toHaveLength(1);
  });

  it("ignores transactions that are not alert-credit purchases", async () => {
    const { handler, alerts } = setup();
    const cases = [
      transaction({ custom_data: { checkout_intent_id: "pci_topup" } }),
      transaction({ status: "billed" }),
      transaction({ custom_data: null }),
      { ...transaction(), data: {} },
    ];
    for (const [index, payload] of cases.entries()) {
      await expect(
        deliver(handler, { ...payload, event_id: `evt_ignored_${index}` }),
      ).resolves.toEqual({ handled: "ignored" });
    }
    expect(await alerts.getBalanceCents("ws_1")).toBe(0);
  });

  it("rejects tampered product, price, quantity, currency, and net before consuming the intent", async () => {
    for (const data of [
      {
        items: [
          {
            price: {
              id: PRICE_ID,
              product_id: "pro_other",
              unit_price: { amount: "1000", currency_code: "EUR" },
            },
            quantity: 2,
          },
        ],
      },
      {
        items: [
          {
            price: {
              id: "pri_other",
              product_id: "pro_alert_credit",
              unit_price: { amount: "1000", currency_code: "EUR" },
            },
            quantity: 2,
          },
        ],
      },
      {
        items: [
          {
            price: {
              id: PRICE_ID,
              product_id: "pro_alert_credit",
              unit_price: { amount: "1000", currency_code: "EUR" },
            },
            quantity: 1,
          },
        ],
      },
      {
        items: [
          {
            price: {
              id: PRICE_ID,
              product_id: "pro_alert_credit",
              unit_price: { amount: "1000", currency_code: "USD" },
            },
            quantity: 2,
          },
        ],
      },
      { currency_code: "USD" },
      { details: { totals: { currency_code: "USD", total: "2000" } } },
      { details: { totals: { currency_code: "EUR", total: "1999" } } },
      { details: { totals: { currency_code: "EUR", total: "2001" } } },
    ]) {
      const { handler, alerts, checkoutIntents } = setup();
      await expect(deliver(handler, transaction(data))).rejects.toThrow();
      expect(await alerts.getBalanceCents("ws_1")).toBe(0);
      await expect(checkoutIntents.findById("pci_topup")).resolves.toMatchObject(
        { consumedAt: null, providerReference: null },
      );
    }
  });

  it("reconciles approved refunds and chargebacks idempotently", async () => {
    const { handler, alerts, audits } = setup();
    await deliver(handler, transaction());
    alerts.setBalance("ws_1", 0); // Simulate credit already spent.
    const adjustment = {
      event_id: "evt_adjustment_1",
      event_type: "adjustment.updated",
      occurred_at: "2026-09-01T00:01:00Z",
      data: {
        id: "adj_1",
        action: "refund",
        status: "approved",
        transaction_id: "txn_1",
        customer_id: "ctm_1",
        currency_code: "EUR",
        totals: { total: "400", currency_code: "EUR" },
      },
    };
    await expect(deliver(handler, adjustment)).resolves.toEqual({
      handled: "processed",
    });
    expect(await alerts.getBalanceCents("ws_1")).toBe(-400);
    await expect(
      deliver(handler, { ...adjustment, event_id: "evt_adjustment_replay" }),
    ).resolves.toEqual({ handled: "processed" });
    expect(await alerts.getBalanceCents("ws_1")).toBe(-400);
    expect(
      (await audits.list("ws_1", null, 10)).map((entry) => entry.action),
    ).toContain("alerts.credit_adjusted");
  });

  it("rejects a different adjustment customer without burning the event id", async () => {
    const { handler, alerts, audits } = setup();
    await deliver(handler, transaction());
    const adjustment = {
      event_id: "evt_adjustment_customer",
      event_type: "adjustment.updated",
      occurred_at: "2026-09-01T00:01:00Z",
      data: {
        id: "adj_customer",
        action: "refund",
        status: "approved",
        transaction_id: "txn_1",
        customer_id: "ctm_other",
        currency_code: "EUR",
        totals: { total: "400", currency_code: "EUR" },
      },
    };

    await expect(deliver(handler, adjustment)).rejects.toThrow(
      "customer does not match credited transaction",
    );
    expect(await alerts.getBalanceCents("ws_1")).toBe(2_000);
    expect(alerts.entries).toHaveLength(1);
    expect(await audits.list("ws_1", null, 10)).toHaveLength(1);

    const corrected = {
      ...adjustment,
      data: { ...adjustment.data, customer_id: "ctm_1" },
    };
    await expect(deliver(handler, corrected)).resolves.toEqual({
      handled: "processed",
    });
    expect(await alerts.getBalanceCents("ws_1")).toBe(1_600);
    await expect(deliver(handler, corrected)).resolves.toEqual({
      handled: "duplicate",
    });
    expect(await alerts.getBalanceCents("ws_1")).toBe(1_600);
  });

  it("restores credit for a provider reversal with a signed negative total", async () => {
    const { handler, alerts } = setup();
    await deliver(handler, transaction());
    const baseAdjustment = {
      occurred_at: "2026-09-01T00:01:00Z",
      event_type: "adjustment.created",
      data: {
        transaction_id: "txn_1",
        customer_id: "ctm_1",
        currency_code: "EUR",
        status: "approved",
        totals: { currency_code: "EUR", total: "400" },
      },
    };
    await deliver(handler, {
      ...baseAdjustment,
      event_id: "evt_adjustment_debit",
      data: { ...baseAdjustment.data, id: "adj_debit", action: "refund" },
    });
    expect(await alerts.getBalanceCents("ws_1")).toBe(1_600);

    const reversal = {
      ...baseAdjustment,
      event_id: "evt_adjustment_reverse",
      data: {
        ...baseAdjustment.data,
        id: "adj_reverse",
        action: "credit_reverse",
        totals: { currency_code: "EUR", total: "-400" },
      },
    };
    await expect(deliver(handler, reversal)).resolves.toEqual({
      handled: "processed",
    });
    expect(await alerts.getBalanceCents("ws_1")).toBe(2_000);

    await expect(
      deliver(handler, { ...reversal, event_id: "evt_adjustment_reverse_replay" }),
    ).resolves.toEqual({ handled: "processed" });
    expect(await alerts.getBalanceCents("ws_1")).toBe(2_000);
  });

  it("fails closed when a reversal has no matching transaction debit", async () => {
    const { handler, alerts } = setup();
    await deliver(handler, transaction());
    await expect(
      deliver(handler, {
        event_id: "evt_bad_reverse_sign",
        event_type: "adjustment.created",
        occurred_at: "2026-09-01T00:01:00Z",
        data: {
          id: "adj_bad_reverse_sign",
          action: "chargeback_reverse",
          status: "approved",
          transaction_id: "txn_1",
          customer_id: "ctm_1",
          currency_code: "EUR",
          totals: { currency_code: "EUR", total: "400" },
        },
      }),
    ).rejects.toThrow("exceeds credited transaction");
    expect(await alerts.getBalanceCents("ws_1")).toBe(2_000);
  });

  it("ignores top-ups when the ledger or price is not configured", async () => {
    const withoutPrice = setup({ priceId: null });
    await expect(deliver(withoutPrice.handler, transaction())).resolves.toEqual({
      handled: "ignored",
    });
    const withoutLedger = setup({ alerts: false });
    await expect(deliver(withoutLedger.handler, transaction())).resolves.toEqual({
      handled: "ignored",
    });
  });
});
