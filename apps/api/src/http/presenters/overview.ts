import type { Overview } from "../../application/overview/get_overview";
import { PLAN_PRICE_CENTS } from "../../shared/constants";

function iso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

export function presentOverview(overview: Overview) {
  return {
    ...overview,
    usage: {
      ...overview.usage,
      projectedTotalCents: Math.max(
        PLAN_PRICE_CENTS,
        overview.usage.projectedTotalCents,
      ),
      periodStart: iso(overview.usage.periodStart),
      periodEnd: iso(overview.usage.periodEnd),
    },
    running: overview.running.map((run) => ({
      ...run,
      startedAt: iso(run.startedAt),
    })),
    activity: overview.activity.map((item) => ({
      ...item,
      occurredAt: iso(item.occurredAt),
    })),
  };
}
