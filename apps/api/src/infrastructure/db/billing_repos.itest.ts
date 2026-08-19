import type {
  OverageReport,
  PendingOveragePeriod,
  Subscription,
  UsageEvent,
} from "../../domain/billing/types";
import { freshDb, testEnv } from "../../test/helpers";
import { D1OverageReportRepo } from "./overage_report_repo";
import { D1PendingOveragePeriodRepo } from "./pending_overage_period_repo";
import { D1SubscriptionRepo } from "./subscription_repo";
import { D1UsageEventRepo } from "./usage_event_repo";

function subscription(
  id: string,
  workspaceId: string,
  periodEnd: number | null,
): Subscription {
  return {
    id,
    workspaceId,
    provider: "paddle",
    providerCustomerId: `ctm_${id}`,
    providerSubscriptionId: `provider_${id}`,
    status: "ACTIVE",
    periodStart: periodEnd === null ? null : periodEnd - 1_000,
    periodEnd,
    cancelAtPeriodEnd: false,
    updatePaymentUrl: null,
    cancelUrl: null,
    createdAt: 100,
    updatedAt: 100,
  };
}

function usage(
  id: string,
  runId: string,
  occurredAt: number,
  changes: Partial<UsageEvent> = {},
): UsageEvent {
  return {
    id,
    workspaceId: "ws_usage",
    testRunId: runId,
    type: "BROWSER_RUN",
    quantity: 1,
    billable: true,
    idempotencyKey: `run:${runId}`,
    occurredAt,
    reversedAt: null,
    createdAt: occurredAt,
    ...changes,
  };
}

describe("D1 billing repositories", () => {
  beforeEach(freshDb);

  it("upserts and finds subscriptions and lists only ended periods", async () => {
    const repo = new D1SubscriptionRepo(testEnv().DB);
    const ended = subscription("sub_ended", "ws_ended", 2_000);
    const later = subscription("sub_later", "ws_later", 4_000);
    const noPeriod = subscription("sub_none", "ws_none", null);
    await repo.upsertByWorkspace(ended);
    await repo.upsertByWorkspace(later);
    await repo.upsertByWorkspace(noPeriod);

    await expect(repo.findByWorkspace("ws_ended")).resolves.toEqual(ended);
    await expect(
      repo.findByProviderSubscriptionId("provider_sub_ended"),
    ).resolves.toEqual(ended);
    await expect(repo.listPeriodEnded(3_000, 10)).resolves.toEqual([ended]);

    await repo.upsertByWorkspace({
      ...ended,
      id: "ignored_replacement_id",
      status: "PAST_DUE",
      cancelAtPeriodEnd: true,
      updatedAt: 500,
    });
    await expect(repo.findByWorkspace("ws_ended")).resolves.toEqual({
      ...ended,
      status: "PAST_DUE",
      cancelAtPeriodEnd: true,
      updatedAt: 500,
    });
  });

  it("rejects stale provider state and paginates only unqueued reports", async () => {
    const subscriptions = new D1SubscriptionRepo(testEnv().DB);
    const reports = new D1OverageReportRepo(testEnv().DB);
    const pendingPeriods = new D1PendingOveragePeriodRepo(testEnv().DB);
    const completed = {
      ...subscription("sub_completed", "ws_completed", 1_000),
      lastProviderEventAt: 200,
    };
    const queued = subscription("sub_queued", "ws_queued", 2_000);
    const first = subscription("sub_first", "ws_first", 3_000);
    const second = subscription("sub_second", "ws_second", 4_000);
    for (const value of [completed, queued, first, second]) {
      await subscriptions.upsertByWorkspace(value);
    }
    await reports.insertIfAbsent({
      id: "ovr_completed",
      workspaceId: completed.workspaceId,
      periodStart: completed.periodStart ?? 0,
      periodEnd: completed.periodEnd ?? 0,
      overageRuns: 0,
      amountCents: 0,
      paddleTransactionId: null,
      reportedAt: 1_100,
      state: "COMPLETED",
      providerMarker: null,
      attemptStartedAt: null,
      completedAt: 1_100,
      providerSubscriptionId: completed.providerSubscriptionId,
    });
    await pendingPeriods.insertIfAbsent({
      workspaceId: queued.workspaceId,
      periodStart: queued.periodStart ?? 0,
      periodEnd: queued.periodEnd ?? 0,
      createdAt: 2_100,
      providerSubscriptionId: queued.providerSubscriptionId,
      nextAttemptAt: 5_000,
      attemptCount: 0,
    });

    await expect(subscriptions.listPeriodEnded(5_000, 1)).resolves.toEqual([
      first,
    ]);
    await expect(
      subscriptions.listPeriodEnded(5_000, 1, {
        periodEnd: first.periodEnd ?? 0,
        id: first.id,
      }),
    ).resolves.toEqual([second]);

    await subscriptions.upsertByWorkspace({
      ...completed,
      status: "CANCELED",
      periodStart: 9_000,
      periodEnd: 10_000,
      lastProviderEventAt: 100,
    });
    await expect(subscriptions.findByWorkspace(completed.workspaceId)).resolves.toEqual(
      completed,
    );
  });

  it("deduplicates, reverses, and counts only billable usage in [from,to)", async () => {
    const repo = new D1UsageEventRepo(testEnv().DB);
    const counted = usage("ue_counted", "run_counted", 100, {
      quantity: 2,
    });
    const reversed = usage("ue_reversed", "run_reversed", 150, {
      quantity: 3,
    });
    const notBillable = usage("ue_free", "run_free", 200, {
      quantity: 4,
      billable: false,
    });
    const boundary = usage("ue_boundary", "run_boundary", 300, {
      quantity: 8,
    });

    await expect(repo.insertIfAbsent(counted)).resolves.toBe("inserted");
    await expect(repo.findByRunId("run_counted")).resolves.toEqual(counted);
    await expect(
      repo.insertIfAbsent({ ...counted, id: "ue_duplicate" }),
    ).resolves.toBe("duplicate");
    await repo.insertIfAbsent(reversed);
    await repo.insertIfAbsent(notBillable);
    await repo.insertIfAbsent(boundary);
    await repo.reverseByRunId("run_reversed", 250);

    await expect(repo.countBillable("ws_usage", 100, 300)).resolves.toBe(2);
    await expect(repo.countBillable("ws_usage", 300, 301)).resolves.toBe(8);
  });

  it("inserts one overage report per workspace period", async () => {
    const repo = new D1OverageReportRepo(testEnv().DB);
    const report: OverageReport = {
      id: "ovr_123",
      workspaceId: "ws_overage",
      periodStart: 1_000,
      periodEnd: 2_000,
      overageRuns: 5,
      amountCents: 100,
      paddleTransactionId: null,
      reportedAt: 2_100,
      state: "PENDING",
      providerMarker: "zenguy:overage:v1:ws_overage:1000",
      attemptStartedAt: null,
      completedAt: null,
      providerSubscriptionId: "provider_sub_overage",
    };

    await expect(repo.findFor("ws_overage", 1_000)).resolves.toBeNull();
    await expect(repo.insertIfAbsent(report)).resolves.toBe("inserted");
    await expect(
      repo.insertIfAbsent({ ...report, id: "ovr_duplicate" }),
    ).resolves.toBe("duplicate");
    await expect(repo.findFor("ws_overage", 1_000)).resolves.toEqual(report);

    await expect(repo.beginAttempt("ovr_123", 2_200)).resolves.toBe(
      true,
    );
    await expect(repo.beginAttempt("ovr_123", 2_201)).resolves.toBe(
      false,
    );
    await expect(repo.findFor("ws_overage", 1_000)).resolves.toEqual({
      ...report,
      state: "AMBIGUOUS",
      attemptStartedAt: 2_200,
    });

    await repo.markCompleted("ovr_123", "txn_overage", 2_400);
    await expect(repo.findFor("ws_overage", 1_000)).resolves.toEqual({
      ...report,
      state: "COMPLETED",
      attemptStartedAt: 2_200,
      paddleTransactionId: "txn_overage",
      completedAt: 2_400,
    });
  });

  it("persists pending rollover periods until they are cleared", async () => {
    const writer = new D1PendingOveragePeriodRepo(testEnv().DB);
    const period: PendingOveragePeriod = {
      workspaceId: "ws_pending_overage",
      periodStart: 1_000,
      periodEnd: 2_000,
      createdAt: 2_100,
      providerSubscriptionId: "provider_sub_pending",
      nextAttemptAt: 2_500,
      attemptCount: 0,
    };

    await expect(writer.insertIfAbsent(period)).resolves.toBe("inserted");
    await expect(writer.insertIfAbsent(period)).resolves.toBe("duplicate");

    const reader = new D1PendingOveragePeriodRepo(testEnv().DB);
    await expect(reader.list(10)).resolves.toEqual([period]);
    await expect(reader.listReady(2_499, 10)).resolves.toEqual([]);
    await expect(reader.listReady(2_500, 10)).resolves.toEqual([period]);
    await reader.rescheduleFor(period.workspaceId, period.periodStart, 3_000);
    await expect(reader.list(10)).resolves.toEqual([
      { ...period, nextAttemptAt: 3_000, attemptCount: 1 },
    ]);
    await reader.deleteFor(period.workspaceId, period.periodStart);
    await expect(reader.list(10)).resolves.toEqual([]);
  });
});
