import type {
  OverageReportRepo,
  SubscriptionRepo,
} from "../../domain/billing/repo";
import type { Clock } from "../../shared/clock";
import { logEvent } from "../../shared/log";
import type { ReportOverageForPeriod } from "./report_overage_for_period";

const SETTLEMENT_DELAY_MS = 60 * 60 * 1_000;

export class SweepOverages {
  constructor(
    private readonly subscriptions: SubscriptionRepo,
    private readonly reports: OverageReportRepo,
    private readonly reporter: Pick<ReportOverageForPeriod, "execute">,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<void> {
    const ended = await this.subscriptions.listPeriodEnded(
      this.clock.now() - SETTLEMENT_DELAY_MS,
      50,
    );
    for (const subscription of ended) {
      if (
        subscription.periodStart === null ||
        subscription.periodEnd === null ||
        (await this.reports.existsFor(
          subscription.workspaceId,
          subscription.periodStart,
        ))
      ) {
        continue;
      }
      try {
        await this.reporter.execute({
          workspaceId: subscription.workspaceId,
          periodStart: subscription.periodStart,
          periodEnd: subscription.periodEnd,
        });
      } catch {
        logEvent("overage_sweep_failed", {
          workspaceId: subscription.workspaceId,
        });
      }
    }
  }
}
