import { buildKpis } from "../lib/kpis";
import type { KpiInput } from "../lib/kpis";
import { Sparkline } from "./charts/Sparkline";
import { KpiCard } from "./KpiCard";

export function KpiStrip(input: KpiInput) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {buildKpis(input).map((kpi) => (
        <KpiCard
          key={kpi.label}
          kpi={kpi}
          spark={
            kpi.spark === undefined || kpi.spark.length < 2 ? undefined : (
              <Sparkline points={kpi.spark} />
            )
          }
        />
      ))}
    </div>
  );
}
