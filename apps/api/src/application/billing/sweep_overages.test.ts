import type {
  OverageReport,
  PendingOveragePeriod,
  Subscription,
} from "../../domain/billing/types";
import { FixedClock } from "../../shared/clock";
import {
  FakeOverageReportRepo,
  FakePendingOveragePeriodRepo,
  FakeSubscriptionRepo,
} from "../../test/fakes/repos";
import { OVERAGE_SETTLEMENT_DELAY_MS } from "./report_overage_for_period";
import { SweepOverages } from "./sweep_overages";

const NOW = Date.parse("2026-09-01T12:00:00Z");

function subscription(
  id: string,
  workspaceId: string,
  periodEnd: number,
): Subscription {
  return {
    id,
    workspaceId,
    provider: "paddle",
    providerCustomerId: `ctm_${id}`,
    providerSubscriptionId: `provider_${id}`,
    status: "ACTIVE",
    periodStart: periodEnd - 30 * 24 * 60 * 60 * 1_000,
    periodEnd,
    cancelAtPeriodEnd: false,
    updatePaymentUrl: null,
    cancelUrl: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

function completedReport(value: Subscription): OverageReport {
  return {
    id: `ovr_${value.id}`,
    workspaceId: value.workspaceId,
    periodStart: value.periodStart ?? 0,
    periodEnd: value.periodEnd ?? 0,
    overageRuns: 0,
    amountCents: 0,
    paddleTransactionId: null,
    reportedAt: NOW,
    state: "COMPLETED",
    providerMarker: null,
    attemptStartedAt: null,
    completedAt: NOW,
    providerSubscriptionId: value.providerSubscriptionId,
  };
}

function pending(
  workspaceId: string,
  changes: Partial<PendingOveragePeriod> = {},
): PendingOveragePeriod {
  const periodEnd = NOW - 2 * OVERAGE_SETTLEMENT_DELAY_MS;
  return {
    workspaceId,
    periodStart: periodEnd - 30 * 24 * 60 * 60 * 1_000,
    periodEnd,
    providerSubscriptionId: `provider_${workspaceId}`,
    createdAt: NOW - 3 * OVERAGE_SETTLEMENT_DELAY_MS,
    nextAttemptAt: NOW,
    attemptCount: 0,
    ...changes,
  };
}

describe("SweepOverages", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reports only periods settled for an hour and pins their subscription", async () => {
    const subscriptions = new FakeSubscriptionRepo();
    const unreported = subscription(
      "sub_unreported",
      "ws_unreported",
      NOW - 2 * OVERAGE_SETTLEMENT_DELAY_MS,
    );
    const reported = subscription(
      "sub_reported",
      "ws_reported",
      NOW - 3 * OVERAGE_SETTLEMENT_DELAY_MS,
    );
    const tooRecent = subscription(
      "sub_recent",
      "ws_recent",
      NOW - OVERAGE_SETTLEMENT_DELAY_MS + 1,
    );
    for (const value of [unreported, reported, tooRecent]) {
      await subscriptions.upsertByWorkspace(value);
    }
    const reports = new FakeOverageReportRepo();
    await reports.insertIfAbsent(completedReport(reported));
    const pendingPeriods = new FakePendingOveragePeriodRepo();
    const calls: Record<string, unknown>[] = [];
    const sweep = new SweepOverages(
      subscriptions,
      reports,
      pendingPeriods,
      {
        execute: async (input) => {
          calls.push({ ...input });
          return { status: "no_overage" } as const;
        },
      },
      new FixedClock(NOW),
    );

    await sweep.execute();

    expect(calls).toEqual([
      {
        workspaceId: unreported.workspaceId,
        periodStart: unreported.periodStart,
        periodEnd: unreported.periodEnd,
        providerSubscriptionId: "provider_sub_unreported",
      },
    ]);
    await expect(pendingPeriods.list(10)).resolves.toEqual([]);
  });

  it("uses a persisted old subscription after the workspace advances", async () => {
    const subscriptions = new FakeSubscriptionRepo();
    await subscriptions.upsertByWorkspace(
      subscription(
        "sub_current",
        "ws_rollover",
        NOW + 30 * 24 * 60 * 60 * 1_000,
      ),
    );
    const reports = new FakeOverageReportRepo();
    const pendingPeriods = new FakePendingOveragePeriodRepo();
    const oldPeriod = pending("ws_rollover", {
      providerSubscriptionId: "provider_sub_old",
    });
    await pendingPeriods.insertIfAbsent(oldPeriod);
    const clock = new FixedClock(NOW);
    let failing = true;
    const calls: Record<string, unknown>[] = [];
    const sweep = new SweepOverages(
      subscriptions,
      reports,
      pendingPeriods,
      {
        execute: async (input) => {
          calls.push({ ...input });
          if (failing) throw new Error("temporary Paddle outage");
          return { status: "no_overage" } as const;
        },
      },
      clock,
    );
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await sweep.execute();
    expect(calls).toEqual([
      expect.objectContaining({ providerSubscriptionId: "provider_sub_old" }),
    ]);
    await expect(pendingPeriods.list(10)).resolves.toEqual([
      { ...oldPeriod, attemptCount: 1, nextAttemptAt: NOW + 60 * 60 * 1_000 },
    ]);

    failing = false;
    await sweep.execute();
    expect(calls).toHaveLength(1);
    clock.advance(60 * 60 * 1_000);
    await sweep.execute();

    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(
      expect.objectContaining({ providerSubscriptionId: "provider_sub_old" }),
    );
    await expect(pendingPeriods.list(10)).resolves.toEqual([]);
  });

  it("reschedules an ambiguous report instead of deleting it", async () => {
    const pendingPeriods = new FakePendingOveragePeriodRepo();
    const oldPeriod = pending("ws_reconciling");
    await pendingPeriods.insertIfAbsent(oldPeriod);
    const sweep = new SweepOverages(
      new FakeSubscriptionRepo(),
      new FakeOverageReportRepo(),
      pendingPeriods,
      { execute: async () => ({ status: "reconciling" }) as const },
      new FixedClock(NOW),
    );

    await sweep.execute();

    await expect(pendingPeriods.list(10)).resolves.toEqual([
      { ...oldPeriod, attemptCount: 1, nextAttemptAt: NOW + 60 * 60 * 1_000 },
    ]);
  });

  it("paginates past fifty completed periods to reach an unreported one", async () => {
    const subscriptions = new FakeSubscriptionRepo();
    const reports = new FakeOverageReportRepo();
    for (let index = 0; index < 50; index += 1) {
      const value = subscription(
        `sub_${String(index).padStart(3, "0")}`,
        `ws_${String(index).padStart(3, "0")}`,
        NOW - (100 - index) * OVERAGE_SETTLEMENT_DELAY_MS,
      );
      await subscriptions.upsertByWorkspace(value);
      await reports.insertIfAbsent(completedReport(value));
    }
    const target = subscription(
      "sub_target",
      "ws_target",
      NOW - 2 * OVERAGE_SETTLEMENT_DELAY_MS,
    );
    await subscriptions.upsertByWorkspace(target);
    const pendingPeriods = new FakePendingOveragePeriodRepo();
    const calls: string[] = [];
    const sweep = new SweepOverages(
      subscriptions,
      reports,
      pendingPeriods,
      {
        execute: async (input) => {
          calls.push(input.workspaceId);
          return { status: "no_overage" } as const;
        },
      },
      new FixedClock(NOW),
    );

    await sweep.execute();

    expect(calls).toEqual(["ws_target"]);
  });

  it("moves fifty poison rows aside and handles the next ready period", async () => {
    const pendingPeriods = new FakePendingOveragePeriodRepo();
    for (let index = 0; index < 50; index += 1) {
      await pendingPeriods.insertIfAbsent(
        pending(`ws_poison_${String(index).padStart(3, "0")}`),
      );
    }
    const good = pending("ws_zz_good");
    await pendingPeriods.insertIfAbsent(good);
    const handled: string[] = [];
    const sweep = new SweepOverages(
      new FakeSubscriptionRepo(),
      new FakeOverageReportRepo(),
      pendingPeriods,
      {
        execute: async (input) => {
          if (input.workspaceId.startsWith("ws_poison_")) {
            throw new Error("permanent provider failure");
          }
          handled.push(input.workspaceId);
          return { status: "no_overage" } as const;
        },
      },
      new FixedClock(NOW),
    );
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await sweep.execute();

    expect(handled).toEqual(["ws_zz_good"]);
    const remaining = await pendingPeriods.list(100);
    expect(remaining).toHaveLength(50);
    expect(remaining.every((period) => period.attemptCount === 1)).toBe(true);
    expect(remaining.every((period) => period.nextAttemptAt > NOW)).toBe(true);
  });
});
