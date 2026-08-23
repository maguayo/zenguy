import type { ActiveWorkspaceRow } from "../../shared/types";
import { formatDateTime, formatNumber, relativeSeconds } from "../lib/format";
import { Card } from "./Card";

const PLAN_LABEL: Record<string, string> = {
  free: "Free",
  grant: "Grant",
  none: "No plan",
  paddle: "Paying",
};

function planLabel(subscription: string): string {
  return PLAN_LABEL[subscription] ?? subscription;
}

/** Who is actually using the product, by the runs they put through it. */
export function ActiveWorkspacesTable({
  now,
  rows,
}: {
  now: number;
  rows: ActiveWorkspaceRow[];
}) {
  return (
    <Card aside="Last 30 days" title="Most active workspaces">
      {rows.length === 0 ? (
        <p className="text-zinc-500">No workspace ran anything in the last 30 days</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="text-xs text-zinc-500">
              <tr>
                <th className="pb-2 font-medium">Workspace</th>
                <th className="pb-2 font-medium">Plan</th>
                <th className="pb-2 font-medium">Runs</th>
                <th className="pb-2 font-medium">Monitors</th>
                <th className="pb-2 font-medium">Last run</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((row) => (
                <tr key={row.workspaceId}>
                  <td className="py-2.5 font-medium">{row.name || "Unnamed workspace"}</td>
                  <td className="py-2.5 text-zinc-500">{planLabel(row.subscription)}</td>
                  <td className="py-2.5 tabular-nums">{formatNumber(row.runs)}</td>
                  <td className="py-2.5 tabular-nums">{formatNumber(row.monitors)}</td>
                  <td className="py-2.5 text-zinc-500">
                    {row.lastRunAt === null ? (
                      "Never"
                    ) : (
                      <span title={formatDateTime(row.lastRunAt)}>
                        {relativeSeconds(row.lastRunAt, now)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
