import type { UsageEvent } from "../../domain/billing/types";
import { FixedClock } from "../../shared/clock";
import { RecordingPaddleClient } from "../../test/fakes/billing";
import { FakeIds } from "../../test/fakes/ids";
import {
  FakeOverageReportRepo,
  FakeUsageEventRepo,
} from "../../test/fakes/repos";
import {
  OVERAGE_SETTLEMENT_DELAY_MS,
  overageProviderMarker,
  ReportOverageForPeriod,
} from "./report_overage_for_period";

const PERIOD_START = Date.parse("2026-08-01T00:00:00Z");
const PERIOD_END = Date.parse("2026-09-01T00:00:00Z");
const SETTLED_NOW = PERIOD_END + OVERAGE_SETTLEMENT_DELAY_MS;

async function setup(
  billableRuns: number,
  paddle = new RecordingPaddleClient(),
  now = SETTLED_NOW,
) {
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
  const clock = new FixedClock(now);
  const reporter = new ReportOverageForPeriod(
    usageEvents,
    reports,
    paddle,
    "pri_overage",
    clock,
    new FakeIds(),
  );
  return { reporter, reports, paddle, clock, usageEvents };
}

const INPUT = {
  workspaceId: "ws_primary",
  periodStart: PERIOD_START,
  periodEnd: PERIOD_END,
  providerSubscriptionId: "sub_provider_old",
};

describe("ReportOverageForPeriod", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has no billing side effects until one full hour after period end", async () => {
    const { reporter, reports, paddle, clock } = await setup(
      301,
      undefined,
      SETTLED_NOW - 1,
    );

    await expect(reporter.execute(INPUT)).resolves.toEqual({
      status: "settling",
    });
    expect(reports.reports.size).toBe(0);
    expect(paddle.charges).toEqual([]);

    clock.advance(1);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    await expect(reporter.execute(INPUT)).resolves.toEqual({
      status: "charged",
      overage: 1,
    });
    expect(paddle.charges).toHaveLength(1);
  });

  it("allows usage reversal during settlement before freezing the total", async () => {
    const { reporter, reports, paddle, clock, usageEvents } = await setup(
      301,
      undefined,
      SETTLED_NOW - 1,
    );

    await expect(reporter.execute(INPUT)).resolves.toEqual({
      status: "settling",
    });
    await usageEvents.reverseByRunId("run_total", SETTLED_NOW - 1);
    clock.advance(1);

    await expect(reporter.execute(INPUT)).resolves.toEqual({
      status: "no_overage",
    });
    expect(paddle.charges).toEqual([]);
    expect([...reports.reports.values()]).toEqual([
      expect.objectContaining({ overageRuns: 0, state: "COMPLETED" }),
    ]);
  });

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
        reportedAt: SETTLED_NOW,
        state: "COMPLETED",
        providerMarker: null,
        attemptStartedAt: null,
        completedAt: SETTLED_NOW,
        providerSubscriptionId: "sub_provider_old",
      }),
    ]);
  });

  it("charges only the overage quantity and stores the pinned subscription", async () => {
    const { reporter, reports, paddle } = await setup(350);
    paddle.chargeResult = { transactionId: "txn_overage" };
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(reporter.execute(INPUT)).resolves.toEqual({
      status: "charged",
      overage: 50,
    });

    expect(paddle.charges).toEqual([
      {
        subscriptionId: "sub_provider_old",
        priceId: "pri_overage",
        quantity: 50,
        marker: overageProviderMarker("ws_primary", PERIOD_START),
      },
    ]);
    expect([...reports.reports.values()]).toEqual([
      expect.objectContaining({
        overageRuns: 50,
        amountCents: 1000,
        paddleTransactionId: "txn_overage",
        state: "COMPLETED",
        providerSubscriptionId: "sub_provider_old",
      }),
    ]);
    expect(String(log.mock.calls[0]?.[0])).toContain(
      '"event":"overage_reported"',
    );
  });

  it("claims a concurrent period before charging so only one POST occurs", async () => {
    const { reporter, reports, paddle } = await setup(301);
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const results = await Promise.all([
      reporter.execute(INPUT),
      reporter.execute(INPUT),
    ]);

    expect(results.filter((result) => result.status === "charged")).toEqual([
      { status: "charged", overage: 1 },
    ]);
    expect(paddle.charges).toHaveLength(1);
    expect(reports.reports.size).toBe(1);
  });

  it("reconciles an accepted timeout against the original subscription", async () => {
    const { reporter, reports, paddle } = await setup(301);
    paddle.chargeFailure = new Error("provider response timed out");
    paddle.acceptChargeBeforeFailure = true;
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(reporter.execute(INPUT)).rejects.toThrow(
      "provider response timed out",
    );
    await expect(
      reporter.execute({
        ...INPUT,
        providerSubscriptionId: "sub_provider_replacement",
      }),
    ).resolves.toEqual({
      status: "reconciled",
      transactionId: "txn_accepted_0001",
    });

    expect(paddle.charges).toHaveLength(1);
    expect(paddle.subscriptionChargeLookups).toEqual([
      {
        subscriptionId: "sub_provider_old",
        marker: overageProviderMarker("ws_primary", PERIOD_START),
      },
    ]);
    expect([...reports.reports.values()]).toEqual([
      expect.objectContaining({
        state: "COMPLETED",
        paddleTransactionId: "txn_accepted_0001",
        providerSubscriptionId: "sub_provider_old",
      }),
    ]);
  });

  it("never retries an ambiguous POST the provider did not expose", async () => {
    const { reporter, reports, paddle, clock } = await setup(301);
    paddle.chargeFailure = new Error("connection timed out before acceptance");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(reporter.execute(INPUT)).rejects.toThrow(
      "connection timed out before acceptance",
    );
    paddle.chargeFailure = null;
    clock.advance(30 * 24 * 60 * 60 * 1_000);

    await expect(reporter.execute(INPUT)).resolves.toEqual({
      status: "reconciling",
    });
    clock.advance(30 * 24 * 60 * 60 * 1_000);
    await expect(reporter.execute(INPUT)).resolves.toEqual({
      status: "reconciling",
    });

    expect(paddle.charges).toHaveLength(1);
    expect(paddle.subscriptionChargeLookups).toHaveLength(2);
    expect([...reports.reports.values()]).toEqual([
      expect.objectContaining({
        state: "AMBIGUOUS",
        attemptStartedAt: SETTLED_NOW,
      }),
    ]);
    expect(log.mock.calls.some((call) =>
      String(call[0]).includes('"event":"overage_reconciliation_pending"'),
    )).toBe(true);
  });
});
