import type { RecentRun } from "../../shared/types";
import { formatDateTime, formatDuration, relativeSeconds } from "../lib/format";
import { Card } from "./Card";
import { StatusBadge } from "./StatusBadge";

/** The worker id that ran the last attempt, or why there is none to show. */
export function runnerLabel(run: RecentRun): { isId: boolean; text: string } {
  if (run.runnerId === "MIGRATION_PENDING") return { isId: false, text: "pending" };
  if (run.runnerId === null) return { isId: false, text: "—" };
  return { isId: true, text: run.runnerId };
}

function attemptsLabel(run: RecentRun): string {
  return run.passedAfterRetry ? `${run.attemptCount} · passed on retry` : `${run.attemptCount}`;
}

export function RecentRunsTable({ now, runs }: { now: number; runs: RecentRun[] }) {
  return (
    <Card aside="Newest first" title="Recent runs">
      {runs.length === 0 ? (
        <p className="text-zinc-500">No runs yet</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="text-xs text-zinc-500">
              <tr>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium">Test</th>
                <th className="pb-2 font-medium">Workspace</th>
                <th className="pb-2 font-medium">Duration</th>
                <th className="pb-2 font-medium">Attempts</th>
                <th className="pb-2 font-medium">Worker</th>
                <th className="pb-2 font-medium">Started</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {runs.map((run) => {
                const runner = runnerLabel(run);
                return (
                  <tr key={run.id}>
                    <td className="py-2.5">
                      <StatusBadge label={run.status} />
                    </td>
                    <td className="py-2.5">
                      <span className="font-medium">{run.testName ?? "Unnamed test"}</span>
                      <span className="block text-xs text-zinc-500">{run.source}</span>
                    </td>
                    <td className="py-2.5 text-zinc-500">{run.workspaceName ?? "—"}</td>
                    <td className="py-2.5 tabular-nums">{formatDuration(run.durationMs)}</td>
                    <td className="py-2.5 text-zinc-500 tabular-nums">{attemptsLabel(run)}</td>
                    <td className="py-2.5">
                      <span className={`text-xs text-zinc-500 ${runner.isId ? "font-mono" : ""}`}>
                        {runner.text}
                      </span>
                      {run.runnerKind ? (
                        <span className="block text-xs text-zinc-500">{run.runnerKind}</span>
                      ) : null}
                    </td>
                    <td className="py-2.5 text-zinc-500">
                      <span title={formatDateTime(run.createdAt)}>
                        {relativeSeconds(run.createdAt, now)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
