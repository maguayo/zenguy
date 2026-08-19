import type { OverageReport, Subscription } from "../../domain/billing/types";
import { FixedClock } from "../../shared/clock";
import {
  FakeOverageReportRepo,
  FakeSubscriptionRepo,
} from "../../test/fakes/repos";
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

describe("SweepOverages", () => {
  it("reports only periods ended over an hour ago without a report", async () => {
    const subscriptions = new FakeSubscriptionRepo();
    const unreported = subscription(
      "sub_unreported",
      "ws_unreported",
      NOW - 2 * 60 * 60 * 1_000,
    );
    const reported = subscription(
      "sub_reported",
      "ws_reported",
      NOW - 3 * 60 * 60 * 1_000,
    );
    const tooRecent = subscription(
      "sub_recent",
      "ws_recent",
      NOW - 30 * 60 * 1_000,
    );
    for (const value of [unreported, reported, tooRecent]) {
      await subscriptions.upsertByWorkspace(value);
    }
    const reports = new FakeOverageReportRepo();
    const existing: OverageReport = {
      id: "ovr_existing",
      workspaceId: reported.workspaceId,
      periodStart: reported.periodStart ?? 0,
      periodEnd: reported.periodEnd ?? 0,
      overageRuns: 0,
      amountCents: 0,
      paddleTransactionId: null,
      reportedAt: NOW,
    };
    await reports.insertIfAbsent(existing);
    const calls: {
      workspaceId: string;
      periodStart: number;
      periodEnd: number;
    }[] = [];
    const sweep = new SweepOverages(
      subscriptions,
      reports,
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
      },
    ]);
  });
});
