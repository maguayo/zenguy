import type {
  SubscriptionRepo,
  UsageEventRepo,
} from "../../domain/billing/repo";
import {
  type BillingCurrency,
  isComplimentarySubscription,
} from "../../domain/billing/types";
import type { Clock } from "../../shared/clock";
import {
  INCLUDED_RUNS,
  OVERAGE_CENTS_PER_RUN,
  PLAN_PRICE_CENTS,
} from "../../shared/constants";

export interface CycleUsage {
  currency: BillingCurrency;
  periodStart: number;
  periodEnd: number;
  billableRuns: number;
  includedRuns: number;
  remainingRuns: number;
  overageRuns: number;
  overageAmountCents: number;
  projectedTotalCents: number;
}

function currentUtcMonth(now: number): {
  periodStart: number;
  periodEnd: number;
} {
  const date = new Date(now);
  return {
    periodStart: Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1),
    periodEnd: Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1),
  };
}

export class GetCycleUsage {
  constructor(
    private readonly subscriptions: SubscriptionRepo,
    private readonly usageEvents: UsageEventRepo,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    workspaceId: string;
    fallbackCurrency?: BillingCurrency;
  }): Promise<CycleUsage> {
    const subscription = await this.subscriptions.findByWorkspace(
      input.workspaceId,
    );
    const period =
      subscription?.periodStart !== null &&
      subscription?.periodStart !== undefined &&
      subscription.periodEnd !== null
        ? {
            periodStart: subscription.periodStart,
            periodEnd: subscription.periodEnd,
          }
        : currentUtcMonth(this.clock.now());
    const billableRuns = await this.usageEvents.countBillable(
      input.workspaceId,
      period.periodStart,
      period.periodEnd,
    );
    const remainingRuns = Math.max(0, INCLUDED_RUNS - billableRuns);
    const complimentary = isComplimentarySubscription(subscription);
    const overageRuns = complimentary
      ? 0
      : Math.max(0, billableRuns - INCLUDED_RUNS);
    const overageAmountCents = overageRuns * OVERAGE_CENTS_PER_RUN;
    return {
      ...period,
      currency: subscription?.currencyCode ?? input.fallbackCurrency ?? "EUR",
      billableRuns,
      includedRuns: INCLUDED_RUNS,
      remainingRuns,
      overageRuns,
      overageAmountCents,
      projectedTotalCents: complimentary
        ? 0
        : PLAN_PRICE_CENTS + overageAmountCents,
    };
  }
}
