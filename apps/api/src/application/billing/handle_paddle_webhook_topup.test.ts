import { WriteAudit } from "../audit/write_audit";
import type { PeriodOverageReporter } from "./handle_paddle_webhook";
import { HandlePaddleWebhook } from "./handle_paddle_webhook";
import { defaultAlertSettings } from "../../domain/alerts/types";
import { FixedClock } from "../../shared/clock";
import { hmacSha256Hex } from "../../shared/crypto";
import { FakeAlertRepo } from "../../test/fakes/alerts";
import { FakeIds } from "../../test/fakes/ids";
import { FakeKv } from "../../test/fakes/kv";
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
      status: "completed",
      custom_data: { workspace_id: "ws_1", purpose: "alert_credit" },
      items: [{ price: { id: PRICE_ID, name: "Alert credit" }, quantity: 2 }],
      ...overrides,
    },
  };
}

function setup(options: { priceId?: string | null; alerts?: boolean } = {}) {
  const clock = new FixedClock(NOW);
  const alerts = new FakeAlertRepo();
  const audits = new FakeAuditRepo();
  const handler = new HandlePaddleWebhook({
    webhookSecret: SIGNING_SECRET,
    kv: new FakeKv(clock),
    subscriptions: new FakeSubscriptionRepo(),
    pendingOveragePeriods: new FakePendingOveragePeriodRepo(),
    overageReporter: noopReporter,
    audit: new WriteAudit({ audits, clock, ids: new FakeIds() }),
    clock,
    ids: new FakeIds(),
    ...(options.alerts === false ? {} : { alerts }),
    alertCreditPriceId:
      options.priceId === undefined ? PRICE_ID : options.priceId,
  });
  return { handler, alerts, audits };
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
      transaction({ custom_data: { workspace_id: "ws_1" } }),
      transaction({ status: "billed" }),
      transaction({ items: [{ price: { id: "pri_other" }, quantity: 1 }] }),
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
