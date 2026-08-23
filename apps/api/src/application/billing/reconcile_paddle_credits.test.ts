import { FixedClock } from "../../shared/clock";
import { FakeAlertRepo } from "../../test/fakes/alerts";
import { RecordingPaddleClient } from "../../test/fakes/billing";
import { FakeIds } from "../../test/fakes/ids";
import { ReconcilePaddleCredits } from "./reconcile_paddle_credits";

const NOW = 1_800_000_000_000;

async function topup(
  alerts: FakeAlertRepo,
  providerCustomerId: string | null = "ctm_one",
): Promise<void> {
  await alerts.credit({
    id: "ace_topup",
    workspaceId: "ws_one",
    kind: "TOPUP",
    amountCents: 1_000,
    deliveryId: null,
    providerTransactionId: "txn_topup",
    providerCustomerId,
    description: "Paddle top-up",
    idempotencyKey: "topup:txn_topup",
    at: NOW - 1_000,
  });
}

describe("ReconcilePaddleCredits", () => {
  it("applies missed approved adjustments once and marks the transaction checked", async () => {
    const alerts = new FakeAlertRepo();
    await topup(alerts);
    const paddle = new RecordingPaddleClient();
    paddle.adjustments = [
      {
        id: "adj_refund",
        action: "refund",
        transactionId: "txn_topup",
        customerId: "ctm_one",
        amountCents: 600,
        currency: "EUR",
      },
      {
        id: "adj_reverse",
        action: "credit_reverse",
        transactionId: "txn_topup",
        customerId: "ctm_one",
        amountCents: -200,
        currency: "EUR",
      },
    ];
    const audit = { execute: vi.fn(async () => undefined) };
    const reconciler = new ReconcilePaddleCredits(
      alerts,
      paddle,
      audit,
      new FixedClock(NOW),
      new FakeIds(),
    );

    await expect(reconciler.execute()).resolves.toEqual({ checked: 1, adjustments: 2 });
    expect(await alerts.getBalanceCents("ws_one")).toBe(600);
    expect(alerts.reconciledTopups.get("txn_topup")).toBe(NOW);
    expect(audit.execute).toHaveBeenCalledTimes(2);

    // Simulate a webhook/poller race or a later retry: ledger keys make it a no-op.
    alerts.reconciledTopups.clear();
    await expect(reconciler.execute()).resolves.toEqual({ checked: 1, adjustments: 0 });
    expect(await alerts.getBalanceCents("ws_one")).toBe(600);
  });

  it("does not mark a top-up reconciled when provider accounting is invalid", async () => {
    const alerts = new FakeAlertRepo();
    await topup(alerts);
    const paddle = new RecordingPaddleClient();
    paddle.adjustments = [
      {
        id: "adj_bad",
        action: "refund",
        transactionId: "txn_topup",
        customerId: "ctm_one",
        amountCents: 100,
        currency: "USD",
      },
    ];
    const reconciler = new ReconcilePaddleCredits(
      alerts,
      paddle,
      { execute: async () => undefined },
      new FixedClock(NOW),
      new FakeIds(),
    );

    await expect(reconciler.execute()).rejects.toThrow("amount or currency");
    expect(alerts.reconciledTopups.has("txn_topup")).toBe(false);
  });

  it("fails closed when a reversal has no prior debit for its transaction", async () => {
    const alerts = new FakeAlertRepo();
    await topup(alerts);
    const paddle = new RecordingPaddleClient();
    paddle.adjustments = [
      {
        id: "adj_bad_reverse",
        action: "chargeback_reverse",
        transactionId: "txn_topup",
        customerId: "ctm_one",
        amountCents: 100,
        currency: "EUR",
      },
    ];
    const reconciler = new ReconcilePaddleCredits(
      alerts,
      paddle,
      { execute: async () => undefined },
      new FixedClock(NOW),
      new FakeIds(),
    );

    await expect(reconciler.execute()).rejects.toThrow(
      "exceeds credited transaction",
    );
    expect(alerts.reconciledTopups.has("txn_topup")).toBe(false);
    expect(await alerts.getBalanceCents("ws_one")).toBe(1_000);
  });

  it("does not let one invalid top-up starve later refunds in the same batch", async () => {
    const alerts = new FakeAlertRepo();
    await topup(alerts);
    await alerts.credit({
      id: "ace_topup_later",
      workspaceId: "ws_two",
      kind: "TOPUP",
      amountCents: 1_000,
      deliveryId: null,
      providerTransactionId: "txn_later",
      providerCustomerId: "ctm_two",
      description: "Paddle top-up",
      idempotencyKey: "topup:txn_later",
      at: NOW - 500,
    });
    const paddle = new RecordingPaddleClient();
    paddle.adjustments = [
      {
        id: "adj_bad",
        action: "refund",
        transactionId: "txn_topup",
        customerId: "ctm_one",
        amountCents: 100,
        currency: "USD",
      },
      {
        id: "adj_later",
        action: "chargeback",
        transactionId: "txn_later",
        customerId: "ctm_two",
        amountCents: 300,
        currency: "EUR",
      },
    ];
    const audit = { execute: vi.fn(async () => undefined) };
    const reconciler = new ReconcilePaddleCredits(
      alerts,
      paddle,
      audit,
      new FixedClock(NOW),
      new FakeIds(),
    );

    await expect(reconciler.execute()).rejects.toThrow("amount or currency");
    expect(paddle.adjustmentRequests).toEqual(["txn_topup", "txn_later"]);
    expect(alerts.reconciledTopups.has("txn_topup")).toBe(false);
    expect(alerts.reconciledTopups.get("txn_later")).toBe(NOW);
    expect(await alerts.getBalanceCents("ws_two")).toBe(700);
    expect(audit.execute).toHaveBeenCalledOnce();
  });

  it("fails closed for mismatched and legacy-missing Paddle customers", async () => {
    for (const providerCustomerId of ["ctm_other", null]) {
      const alerts = new FakeAlertRepo();
      await topup(alerts, providerCustomerId);
      const paddle = new RecordingPaddleClient();
      paddle.adjustments = [
        {
          id: `adj_customer_${providerCustomerId ?? "missing"}`,
          action: "refund",
          transactionId: "txn_topup",
          customerId: "ctm_one",
          amountCents: 100,
          currency: "EUR",
        },
      ];
      const audit = { execute: vi.fn(async () => undefined) };
      const reconciler = new ReconcilePaddleCredits(
        alerts,
        paddle,
        audit,
        new FixedClock(NOW),
        new FakeIds(),
      );

      await expect(reconciler.execute()).rejects.toThrow(
        providerCustomerId === null ? "identity missing" : "customer mismatch",
      );
      expect(await alerts.getBalanceCents("ws_one")).toBe(1_000);
      expect(alerts.reconciledTopups.has("txn_topup")).toBe(false);
      expect(audit.execute).not.toHaveBeenCalled();
    }
  });

  it("does not mark a legacy top-up reconciled even when Paddle returns no adjustments", async () => {
    const alerts = new FakeAlertRepo();
    await topup(alerts, null);
    const paddle = new RecordingPaddleClient();
    const reconciler = new ReconcilePaddleCredits(
      alerts,
      paddle,
      { execute: async () => undefined },
      new FixedClock(NOW),
      new FakeIds(),
    );

    await expect(reconciler.execute()).rejects.toThrow("identity missing");
    expect(paddle.adjustmentRequests).toEqual([]);
    expect(alerts.reconciledTopups.has("txn_topup")).toBe(false);
  });
});
