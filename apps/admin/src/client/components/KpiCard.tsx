import type { ReactNode } from "react";

import type { DeltaTone, Kpi } from "../lib/kpis";

const DELTA_CLASS: Record<DeltaTone, string> = {
  danger: "text-danger-700",
  neutral: "text-zinc-500",
  ok: "text-ok-700",
};

/**
 * A stat tile with a floor: either the fortnight's shape or the breakdown behind
 * the number. Every tile has the band, so the strip stays one straight line of
 * cards whether or not a metric has a series behind it.
 */
export function KpiCard({ kpi, spark }: { kpi: Kpi; spark?: ReactNode }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="flex-1 p-4">
        <p className="text-zinc-500">{kpi.label}</p>
        <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
          <span
            className={`text-2xl font-semibold tabular-nums ${kpi.tone === "danger" ? "text-danger-700" : ""}`}
          >
            {kpi.value}
          </span>
          {kpi.delta === undefined ? null : (
            <span className={`font-mono text-xs font-medium ${DELTA_CLASS[kpi.delta.tone]}`}>
              {kpi.delta.text}
            </span>
          )}
        </p>
        {kpi.hint === undefined ? null : (
          <p className="mt-1 text-xs text-zinc-500">{kpi.hint}</p>
        )}
      </div>
      <div className="flex h-10 items-center border-t border-zinc-100">
        {spark === undefined ? (
          <p className="px-4 text-xs text-zinc-500">{kpi.detail ?? ""}</p>
        ) : (
          <div className="w-full">{spark}</div>
        )}
      </div>
    </div>
  );
}
