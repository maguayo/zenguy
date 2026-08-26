import type {
  OverageReportRepo,
  UsageEventRepo,
} from "../../domain/billing/repo";
import type { OverageReport } from "../../domain/billing/types";
import type { BillingProviderClient } from "../../infrastructure/billing/provider";
import type { Clock } from "../../shared/clock";
import {
  INCLUDED_RUNS,
  OVERAGE_CENTS_PER_RUN,
} from "../../shared/constants";
import type { IdGenerator } from "../../shared/ids";
import { logEvent } from "../../shared/log";

export const OVERAGE_SETTLEMENT_DELAY_MS = 60 * 60 * 1_000;

export type OverageReportResult =
  | { status: "already_reported" }
  | { status: "no_overage" }
  | { status: "skipped" }
  | { status: "settling" }
  | { status: "reconciling" }
  | { status: "reconciled"; transactionId: string }
  | { status: "charged"; overage: number };

export function overageProviderMarker(
  workspaceId: string,
  periodStart: number,
): string {
  return `zenguy:overage:v1:${workspaceId}:${periodStart}`;
}

export class ReportOverageForPeriod {
  constructor(
    private readonly usageEvents: UsageEventRepo,
    private readonly reports: OverageReportRepo,
    private readonly billingProvider: BillingProviderClient,
    private readonly overagePriceId: string,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: {
    workspaceId: string;
    periodStart: number;
    periodEnd: number;
    providerSubscriptionId: string | null;
  }): Promise<OverageReportResult> {
    const requestedProviderSubscriptionId = input.providerSubscriptionId;
    if (
      requestedProviderSubscriptionId === null ||
      requestedProviderSubscriptionId === ""
    ) {
      return { status: "skipped" };
    }
    const settledInput = {
      workspaceId: input.workspaceId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      providerSubscriptionId: requestedProviderSubscriptionId,
    };
    let report = await this.reports.findFor(
      input.workspaceId,
      input.periodStart,
    );
    const now = this.clock.now();
    const settledPeriodEnd = report?.periodEnd ?? input.periodEnd;
    if (now < settledPeriodEnd + OVERAGE_SETTLEMENT_DELAY_MS) {
      return { status: "settling" };
    }
    if (report === null) {
      const created = await this.createReport(settledInput);
      const inserted = await this.reports.insertIfAbsent(created);
      if (inserted === "inserted") {
        if (created.state === "COMPLETED") {
          return { status: "no_overage" };
        }
        report = created;
      } else {
        report = await this.reports.findFor(
          input.workspaceId,
          input.periodStart,
        );
        if (report === null) {
          throw new Error("Overage report claim missing");
        }
      }
    }

    if (report.state === "COMPLETED") {
      return { status: "already_reported" };
    }
    const providerMarker = report.providerMarker;
    if (providerMarker === null) {
      throw new Error("Overage report marker missing");
    }
    const providerSubscriptionId = report.providerSubscriptionId;
    if (providerSubscriptionId === null) {
      logEvent("overage_reconciliation_requires_subscription", {
        workspaceId: report.workspaceId,
      });
      return { status: "reconciling" };
    }

    if (report.state === "AMBIGUOUS") {
      const reconciled = await this.reconcile(
        report,
        providerSubscriptionId,
        providerMarker,
      );
      if (reconciled !== null) return reconciled;
      // Legacy providers may not support idempotent retries. Reconcile a
      // persisted ambiguous attempt before considering another charge.
      logEvent("overage_reconciliation_pending", {
        workspaceId: report.workspaceId,
      });
      return { status: "reconciling" };
    }

    // Persist AMBIGUOUS before the external mutation. Stripe additionally uses
    // the marker as its idempotency key, while legacy rows remain fail-closed.
    const began = await this.reports.beginAttempt(report.id, now);
    if (!began) return { status: "reconciling" };

    const { transactionId } = await this.billingProvider.createOneTimeCharge(
      providerSubscriptionId,
      this.overagePriceId,
      report.overageRuns,
      providerMarker,
    );
    await this.reports.markCompleted(report.id, transactionId, this.clock.now());
    logEvent("overage_reported", {
      workspaceId: report.workspaceId,
      overage: report.overageRuns,
    });
    return { status: "charged", overage: report.overageRuns };
  }

  private async createReport(input: {
    workspaceId: string;
    periodStart: number;
    periodEnd: number;
    providerSubscriptionId: string;
  }): Promise<OverageReport> {
    const billable = await this.usageEvents.countBillable(
      input.workspaceId,
      input.periodStart,
      input.periodEnd,
    );
    const overage = Math.max(0, billable - INCLUDED_RUNS);
    const now = this.clock.now();
    return {
      id: this.ids.newId("ovr"),
      workspaceId: input.workspaceId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      overageRuns: overage,
      amountCents: overage * OVERAGE_CENTS_PER_RUN,
      paddleTransactionId: null,
      reportedAt: now,
      state: overage === 0 ? "COMPLETED" : "PENDING",
      providerMarker:
        overage === 0
          ? null
          : overageProviderMarker(input.workspaceId, input.periodStart),
      attemptStartedAt: null,
      completedAt: overage === 0 ? now : null,
      providerSubscriptionId: input.providerSubscriptionId,
    };
  }

  private async reconcile(
    report: OverageReport,
    subscriptionId: string,
    providerMarker: string,
  ): Promise<OverageReportResult | null> {
    const match = await this.billingProvider.findSubscriptionChargeByMarker(
      subscriptionId,
      providerMarker,
    );
    if (match === null) return null;
    await this.reports.markCompleted(
      report.id,
      match.transactionId,
      this.clock.now(),
    );
    logEvent("overage_reconciled", {
      workspaceId: report.workspaceId,
      overage: report.overageRuns,
    });
    return {
      status: "reconciled",
      transactionId: match.transactionId,
    };
  }
}
