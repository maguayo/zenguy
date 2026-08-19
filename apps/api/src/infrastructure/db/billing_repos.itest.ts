import type {
  OverageReport,
  Subscription,
  UsageEvent,
} from "../../domain/billing/types";
import { freshDb, testEnv } from "../../test/helpers";
import { D1OverageReportRepo } from "./overage_report_repo";
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
    };

    await expect(repo.existsFor("ws_overage", 1_000)).resolves.toBe(false);
    await expect(repo.insertIfAbsent(report)).resolves.toBe("inserted");
    await expect(
      repo.insertIfAbsent({ ...report, id: "ovr_duplicate" }),
    ).resolves.toBe("duplicate");
    await expect(repo.existsFor("ws_overage", 1_000)).resolves.toBe(true);
  });
});
