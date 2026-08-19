import type { Overview } from "../../application/overview/get_overview";

function iso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

export function presentOverview(overview: Overview) {
  return {
    ...overview,
    usage: {
      ...overview.usage,
      periodStart: iso(overview.usage.periodStart),
      periodEnd: iso(overview.usage.periodEnd),
    },
    activity: overview.activity.map((item) => ({
      ...item,
      occurredAt: iso(item.occurredAt),
    })),
  };
}
