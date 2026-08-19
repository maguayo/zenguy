import type { Subscription, UsageEvent } from "../../domain/billing/types";
import { FixedClock } from "../../shared/clock";
import { RecordingPaddleClient } from "../../test/fakes/billing";
import { FakeIds } from "../../test/fakes/ids";
import {
  FakeOverageReportRepo,
  FakeSubscriptionRepo,
  FakeUsageEventRepo,
} from "../../test/fakes/repos";
import { ReportOverageForPeriod } from "./report_overage_for_period";

const PERIOD_START = Date.parse("2026-08-01T00:00:00Z");
const PERIOD_END = Date.parse("2026-09-01T00:00:00Z");
const NOW = PERIOD_END + 1_000;
const SUBSCRIPTION: Subscription = {
  id: "sub_local",
  workspaceId: "ws_primary",
  provider: "paddle",
  providerCustomerId: "ctm_123",
  providerSubscriptionId: "sub_provider",
  status: "ACTIVE",
  periodStart: PERIOD_START,
  periodEnd: PERIOD_END,
  cancelAtPeriodEnd: false,
  updatePaymentUrl: null,
  cancelUrl: null,
  createdAt: PERIOD_START,
  updatedAt: PERIOD_START,
};

async function setup(
  billableRuns: number,
  paddle = new RecordingPaddleClient(),
) {
  const subscriptions = new FakeSubscriptionRepo();
  await subscriptions.upsertByWorkspace(SUBSCRIPTION);
  const usageEvents = new FakeUsageEventRepo();
  if (billableRuns > 0) {
    const event: UsageEvent = {
      id: "ue_total",
      workspaceId: "ws_primary",
      testRunId: "run_total",
      type: "BROWSER_RUN",
      quantity: billableRuns,
      billable: true,
      idempotencyKey: "run:run_total",
      occurredAt: PERIOD_START,
      reversedAt: null,
      createdAt: PERIOD_START,
    };
    await usageEvents.insertIfAbsent(event);
  }
  const reports = new FakeOverageReportRepo();
  const reporter = new ReportOverageForPeriod(
    subscriptions,
    usageEvents,
    reports,
    paddle,
    "pri_overage",
    new FixedClock(NOW),
    new FakeIds(),
  );
  return { reporter, reports, paddle };
}

const INPUT = {
  workspaceId: "ws_primary",
  periodStart: PERIOD_START,
  periodEnd: PERIOD_END,
};

describe("ReportOverageForPeriod", () => {
  it("records a no-overage period exactly once", async () => {
    const { reporter, reports, paddle } = await setup(300);

    await expect(reporter.execute(INPUT)).resolves.toEqual({
      status: "no_overage",
    });
    await expect(reporter.execute(INPUT)).resolves.toEqual({
      status: "already_reported",
    });

    expect(paddle.charges).toEqual([]);
    expect([...reports.reports.values()]).toEqual([
      expect.objectContaining({
        workspaceId: "ws_primary",
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
        overageRuns: 0,
        amountCents: 0,
        paddleTransactionId: null,
        reportedAt: NOW,
      }),
    ]);
  });

  it("charges only the overage quantity and stores the transaction", async () => {
    const { reporter, reports, paddle } = await setup(350);
    paddle.chargeResult = { transactionId: "txn_overage" };
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(reporter.execute(INPUT)).resolves.toEqual({
      status: "charged",
      overage: 50,
    });

    expect(paddle.charges).toEqual([
      {
        subscriptionId: "sub_provider",
        priceId: "pri_overage",
        quantity: 50,
      },
    ]);
    expect([...reports.reports.values()]).toEqual([
      expect.objectContaining({
        overageRuns: 50,
        amountCents: 1000,
        paddleTransactionId: "txn_overage",
      }),
    ]);
    expect(String(log.mock.calls[0]?.[0])).toContain(
      '"event":"overage_reported"',
    );
    log.mockRestore();
  });

  it("claims a concurrent period before charging so only one charge occurs", async () => {
    const { reporter, reports, paddle } = await setup(301);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const results = await Promise.all([
      reporter.execute(INPUT),
      reporter.execute(INPUT),
    ]);

    expect(results).toContainEqual({ status: "charged", overage: 1 });
    expect(results).toContainEqual({ status: "already_reported" });
    expect(paddle.charges).toHaveLength(1);
    expect(reports.reports.size).toBe(1);
    log.mockRestore();
  });

  it("releases an uncharged claim when Paddle fails so a sweep can retry", async () => {
    const { reporter, reports } = await setup(
      301,
      new RecordingPaddleClient(new Error("provider unavailable")),
    );

    await expect(reporter.execute(INPUT)).rejects.toThrow(
      "provider unavailable",
    );

    expect(reports.reports.size).toBe(0);
  });
});
