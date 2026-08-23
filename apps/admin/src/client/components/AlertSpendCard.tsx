import type { AnalyticsBusiness, DeliveriesDay } from "../../shared/types";
import { formatEuros, sumSeries } from "../lib/series";
import { Card } from "./Card";

/** What notifying customers cost, against what they have paid in for it. */
export function AlertSpendCard({
  business,
  days,
  deliveries,
}: {
  business: AnalyticsBusiness;
  days: number;
  deliveries: DeliveriesDay[];
}) {
  return (
    <Card title="Alert spend">
      <p className="text-2xl font-semibold">{formatEuros(sumSeries(deliveries, "costCents"))}</p>
      <p className="mt-1 text-xs text-zinc-500">{`Last ${days} days`}</p>
      <dl className="mt-3 border-t border-zinc-100 pt-3">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-zinc-500">Credits bought 30 d</dt>
          <dd className="font-mono font-medium tabular-nums">
            {formatEuros(business.creditTopupsCents30d)}
          </dd>
        </div>
      </dl>
    </Card>
  );
}
