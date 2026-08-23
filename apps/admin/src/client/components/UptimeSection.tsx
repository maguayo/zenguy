import type { Overview, PastChecksWindow } from "../../shared/types";
import { formatNumber } from "../lib/format";
import { Card } from "./Card";
import { StatusBadge } from "./StatusBadge";
import { UpcomingRow, WINDOWS } from "./Windows";

/**
 * Never rounds a window that had failures up to a clean 100%: "100% up" next to
 * "2 down" is exactly the kind of number an operator stops trusting.
 */
function upRate(window: PastChecksWindow): string {
  if (window.down === 0) return "100%";
  return `${(Math.floor((window.up / window.total) * 1_000) / 10).toFixed(1)}%`;
}

export function UptimeSection({ overview }: { overview: Overview }) {
  const { past, upcoming } = overview.uptimeChecks;
  const monitors = overview.uptimeMonitors;
  return (
    <Card title="Uptime">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-zinc-500">{`Monitors ${formatNumber(monitors.total)}`}</span>
        <StatusBadge label={`UP ${formatNumber(monitors.up)}`} status="UP" />
        <StatusBadge label={`DOWN ${formatNumber(monitors.down)}`} status="DOWN" />
        <StatusBadge label={`UNKNOWN ${formatNumber(monitors.unknown)}`} status="UNKNOWN" />
      </div>
      <table className="mt-3 w-full text-left">
        <thead className="text-xs text-zinc-500">
          <tr>
            <th className="pb-2 font-medium">Window</th>
            <th className="pb-2 font-medium">Checks</th>
            <th className="pb-2 font-medium">Up rate</th>
            <th className="pb-2 font-medium">Down</th>
            <th className="pb-2 font-medium">Avg response</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {WINDOWS.map((window) => {
            const stats = past[window.key];
            return (
              <tr key={window.key}>
                <th className="py-2.5 font-medium" scope="row">
                  {window.label}
                </th>
                {stats.total === 0 ? (
                  <td className="py-2.5 text-zinc-500" colSpan={4}>
                    No checks in this window
                  </td>
                ) : (
                  <>
                    <td className="py-2.5 tabular-nums">{formatNumber(stats.total)}</td>
                    <td className="py-2.5 tabular-nums">{upRate(stats)}</td>
                    <td
                      className={`py-2.5 tabular-nums ${stats.down > 0 ? "text-danger-700" : ""}`}
                    >
                      {formatNumber(stats.down)}
                    </td>
                    <td className="py-2.5 tabular-nums">
                      {stats.avgResponseMs === null ? "—" : `${formatNumber(stats.avgResponseMs)} ms`}
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <UpcomingRow upcoming={upcoming} />
    </Card>
  );
}
