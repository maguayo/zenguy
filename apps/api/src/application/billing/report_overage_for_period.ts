import type {
  OverageReportRepo,
  SubscriptionRepo,
  UsageEventRepo,
} from "../../domain/billing/repo";
import type { PaddleClient } from "../../infrastructure/paddle/client";
import type { Clock } from "../../shared/clock";
import {
  INCLUDED_RUNS,
  OVERAGE_CENTS_PER_RUN,
} from "../../shared/constants";
import type { IdGenerator } from "../../shared/ids";
import { logEvent } from "../../shared/log";

export type OverageReportResult =
  | { status: "already_reported" }
  | { status: "no_overage" }
  | { status: "charged"; overage: number };

export class ReportOverageForPeriod {
  constructor(
    private readonly subscriptions: SubscriptionRepo,
    private readonly usageEvents: UsageEventRepo,
    private readonly reports: OverageReportRepo,
    private readonly paddle: PaddleClient,
    private readonly overagePriceId: string,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: {
    workspaceId: string;
    periodStart: number;
    periodEnd: number;
  }): Promise<OverageReportResult> {
    if (await this.reports.existsFor(input.workspaceId, input.periodStart)) {
      return { status: "already_reported" };
    }
    const billable = await this.usageEvents.countBillable(
      input.workspaceId,
      input.periodStart,
      input.periodEnd,
    );
    const overage = Math.max(0, billable - INCLUDED_RUNS);
    const report = {
      id: this.ids.newId("ovr"),
      workspaceId: input.workspaceId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      overageRuns: overage,
      amountCents: overage * OVERAGE_CENTS_PER_RUN,
      paddleTransactionId: null,
      reportedAt: this.clock.now(),
    };
    if (overage === 0) {
      const inserted = await this.reports.insertIfAbsent(report);
      return inserted === "duplicate"
        ? { status: "already_reported" }
        : { status: "no_overage" };
    }

    const subscription = await this.subscriptions.findByWorkspace(
      input.workspaceId,
    );
    if (subscription?.providerSubscriptionId === null ||
        subscription?.providerSubscriptionId === undefined) {
      throw new Error("Paddle subscription required for overage");
    }

    // DEVIATION: claim the unique period row before the external charge. The
    // requested charge-then-insert order permits two concurrent workers to
    // charge twice; this claim makes the stated never-double-charge guarantee.
    const claimed = await this.reports.insertIfAbsent(report);
    if (claimed === "duplicate") return { status: "already_reported" };

    let transactionId: string | null;
    try {
      ({ transactionId } = await this.paddle.createOneTimeCharge(
        subscription.providerSubscriptionId,
        this.overagePriceId,
        overage,
      ));
    } catch (error) {
      await this.reports.deleteById(report.id);
      throw error;
    }
    if (transactionId !== null) {
      await this.reports.setPaddleTransactionId(report.id, transactionId);
    }
    logEvent("overage_reported", {
      workspaceId: input.workspaceId,
      overage,
    });
    return { status: "charged", overage };
  }
}
