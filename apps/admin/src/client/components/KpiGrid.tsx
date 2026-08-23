import type { Overview } from "../../shared/types";
import { formatNumber } from "../lib/format";

interface Kpi {
  hint?: string;
  label: string;
  value: string;
}

function kpis(overview: Overview): Kpi[] {
  const monitors = overview.uptimeMonitors;
  return [
    {
      hint: `${formatNumber(overview.users.verified)} verified · ${formatNumber(overview.users.newLast7d)} new in 7d`,
      label: "Users",
      value: formatNumber(overview.users.total),
    },
    {
      label: "Workspaces",
      value: formatNumber(overview.workspaces.total),
    },
    {
      hint: "not deleted",
      label: "Active browser tests",
      value: formatNumber(overview.browserTests.active),
    },
    {
      hint: `${formatNumber(monitors.up)} up · ${formatNumber(monitors.down)} down · ${formatNumber(monitors.unknown)} unknown`,
      label: "Monitors",
      value: formatNumber(monitors.total),
    },
  ];
}

export function KpiGrid({ overview }: { overview: Overview }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-zinc-900">Platform</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpis(overview).map((kpi) => (
          <div className="rounded-lg border border-zinc-200 bg-white p-4" key={kpi.label}>
            <p className="text-zinc-500">{kpi.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{kpi.value}</p>
            {kpi.hint ? <p className="mt-1 text-xs text-zinc-500">{kpi.hint}</p> : null}
          </div>
        ))}
      </div>
    </section>
  );
}
