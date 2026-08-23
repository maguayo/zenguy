import type { TestLeaderboardRow } from "../../shared/types";
import { formatDuration, formatNumber, percent } from "../lib/format";
import { Card } from "./Card";

export type LeaderboardKind = "failing" | "slow";

const EMPTY: Record<LeaderboardKind, string> = {
  failing: "No test failed in the last 7 days",
  slow: "No test has enough finished runs to rank",
};

/**
 * The two 7-day leaderboards share a shape: the test and its workspace on the
 * left, then the numbers that earned it the place.
 */
export function TestLeaderboard({
  kind,
  rows,
  title,
}: {
  kind: LeaderboardKind;
  rows: TestLeaderboardRow[];
  title: string;
}) {
  return (
    <Card aside="Last 7 days" title={title}>
      {rows.length === 0 ? (
        <p className="text-zinc-500">{EMPTY[kind]}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="text-xs text-zinc-500">
              <tr>
                <th className="pb-2 font-medium">Test</th>
                <th className="pb-2 font-medium">Runs</th>
                {kind === "failing" ? (
                  <>
                    <th className="pb-2 font-medium">Failed</th>
                    <th className="pb-2 font-medium">Pass rate</th>
                  </>
                ) : (
                  <th className="pb-2 font-medium">Avg duration</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((row) => (
                <tr key={row.testId}>
                  <td className="py-2.5">
                    <span className="font-medium">{row.name || "Unnamed test"}</span>
                    <span className="block text-xs text-zinc-500">
                      {row.workspaceName ?? "Unknown workspace"}
                    </span>
                  </td>
                  <td className="py-2.5 tabular-nums">{formatNumber(row.runs)}</td>
                  {kind === "failing" ? (
                    <>
                      <td className="py-2.5 font-medium text-danger-700 tabular-nums">
                        {formatNumber(row.failed)}
                      </td>
                      <td className="py-2.5 tabular-nums">{percent(row.passRate)}</td>
                    </>
                  ) : (
                    <td className="py-2.5 tabular-nums">{formatDuration(row.avgDurationMs)}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
