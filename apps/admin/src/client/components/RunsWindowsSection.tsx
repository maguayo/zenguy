import type { Overview, PastRunsWindow } from "../../shared/types";
import { formatDuration, formatNumber, percent } from "../lib/format";
import { Card } from "./Card";
import { UpcomingRow, WINDOWS } from "./Windows";

function breakdown(window: PastRunsWindow): string {
  return Object.entries(window.byStatus)
    .sort(([, a], [, b]) => b - a)
    .map(([status, count]) => `${status} ${formatNumber(count)}`)
    .join(" · ");
}

export function RunsWindowsSection({ overview }: { overview: Overview }) {
  const { past, upcoming } = overview.browserRuns;
  return (
    <Card title="Browser runs">
      <table className="w-full text-left">
        <thead className="text-xs text-zinc-500">
          <tr>
            <th className="pb-2 font-medium">Window</th>
            <th className="pb-2 font-medium">Runs</th>
            <th className="pb-2 font-medium">Pass rate</th>
            <th className="pb-2 font-medium">Avg duration</th>
            <th className="pb-2 font-medium">Breakdown</th>
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
                    No runs in this window
                  </td>
                ) : (
                  <>
                    <td className="py-2.5 tabular-nums">{formatNumber(stats.total)}</td>
                    <td className="py-2.5 tabular-nums">{percent(stats.passRate)}</td>
                    <td className="py-2.5 tabular-nums">{formatDuration(stats.avgDurationMs)}</td>
                    <td className="py-2.5 text-zinc-500">{breakdown(stats)}</td>
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
