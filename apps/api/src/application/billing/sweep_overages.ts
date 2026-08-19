import type {
  OverageReportRepo,
  PendingOveragePeriodRepo,
  SubscriptionRepo,
} from "../../domain/billing/repo";
import type { PendingOveragePeriod } from "../../domain/billing/types";
import type { Clock } from "../../shared/clock";
import { logEvent } from "../../shared/log";
import {
  OVERAGE_SETTLEMENT_DELAY_MS,
  type ReportOverageForPeriod,
} from "./report_overage_for_period";

const PAGE_SIZE = 50;
const RETRY_BASE_MS = 60 * 60 * 1_000;
const RETRY_MAX_MS = 24 * 60 * 60 * 1_000;

function retryAt(now: number, attemptCount: number): number {
  const multiplier = 2 ** Math.min(attemptCount, 5);
  return now + Math.min(RETRY_MAX_MS, RETRY_BASE_MS * multiplier);
}

export class SweepOverages {
  constructor(
    private readonly subscriptions: SubscriptionRepo,
    private readonly reports: OverageReportRepo,
    private readonly pendingPeriods: PendingOveragePeriodRepo,
    private readonly reporter: Pick<ReportOverageForPeriod, "execute">,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<void> {
    const now = this.clock.now();
    const settlementCutoff = now - OVERAGE_SETTLEMENT_DELAY_MS;
    await this.materializeEndedPeriods(settlementCutoff, now);

    // Successfully handled rows are deleted and unsuccessful rows are moved
    // into the future, so each page makes progress and poison rows cannot pin
    // the head of the ready queue.
    for (;;) {
      const pending = await this.pendingPeriods.listReady(now, PAGE_SIZE);
      if (pending.length === 0) return;
      for (const period of pending) {
        await this.processPending(period, now);
      }
      if (pending.length < PAGE_SIZE) return;
    }
  }

  private async materializeEndedPeriods(
    settlementCutoff: number,
    now: number,
  ): Promise<void> {
    let after: { periodEnd: number; id: string } | undefined;
    for (;;) {
      const ended = await this.subscriptions.listPeriodEnded(
        settlementCutoff,
        PAGE_SIZE,
        after,
      );
      if (ended.length === 0) return;
      for (const subscription of ended) {
        if (subscription.periodStart === null || subscription.periodEnd === null) {
          continue;
        }
        if (
          subscription.source === "grant" ||
          subscription.providerSubscriptionId === null
        ) {
          continue;
        }
        const report = await this.reports.findFor(
          subscription.workspaceId,
          subscription.periodStart,
        );
        if (report?.state === "COMPLETED") continue;
        await this.pendingPeriods.insertIfAbsent({
          workspaceId: subscription.workspaceId,
          periodStart: subscription.periodStart,
          periodEnd: subscription.periodEnd,
          providerSubscriptionId: subscription.providerSubscriptionId,
          createdAt: now,
          nextAttemptAt:
            subscription.periodEnd + OVERAGE_SETTLEMENT_DELAY_MS,
          attemptCount: 0,
        });
      }
      const last = ended.at(-1);
      if (last?.periodEnd === null || last?.periodEnd === undefined) return;
      after = { periodEnd: last.periodEnd, id: last.id };
      if (ended.length < PAGE_SIZE) return;
    }
  }

  private async processPending(
    period: PendingOveragePeriod,
    now: number,
  ): Promise<void> {
    try {
      if (period.providerSubscriptionId === null) {
        logEvent("overage_skipped_complimentary", {
          workspaceId: period.workspaceId,
        });
        await this.pendingPeriods.deleteFor(
          period.workspaceId,
          period.periodStart,
        );
        return;
      }
      const result = await this.reporter.execute({
        workspaceId: period.workspaceId,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        providerSubscriptionId: period.providerSubscriptionId,
      });
      if (result.status === "reconciling" || result.status === "settling") {
        await this.reschedule(period, now);
        return;
      }
      await this.pendingPeriods.deleteFor(
        period.workspaceId,
        period.periodStart,
      );
    } catch {
      logEvent("overage_sweep_failed", {
        workspaceId: period.workspaceId,
      });
      await this.reschedule(period, now);
    }
  }

  private async reschedule(
    period: PendingOveragePeriod,
    now: number,
  ): Promise<void> {
    await this.pendingPeriods.rescheduleFor(
      period.workspaceId,
      period.periodStart,
      Math.max(
        period.periodEnd + OVERAGE_SETTLEMENT_DELAY_MS,
        retryAt(now, period.attemptCount),
      ),
    );
  }
}
