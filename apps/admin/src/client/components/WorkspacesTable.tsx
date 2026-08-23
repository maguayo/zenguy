import type { ActiveWorkspaceRow, WorkspacesResponse } from "../../shared/types";
import type { WorkspaceRow } from "../lib/activity";
import { joinWorkspaceRows } from "../lib/activity";
import { formatDate, formatDateTime, formatNumber, relativeSeconds } from "../lib/format";
import { Card } from "./Card";
import { StatusBadge } from "./StatusBadge";

const EM_DASH = "—";

const PLAN_LABEL: Record<string, string> = {
  free: "Free",
  grant: "Grant",
  none: "No plan",
  paddle: "Paying",
};

function planLabel(subscription: string): string {
  return PLAN_LABEL[subscription] ?? subscription;
}

/** A moment, or nothing: the workspace has never done that thing. */
function Ago({ at, now }: { at: number | null; now: number }) {
  if (at === null) return <>{EM_DASH}</>;
  return <span title={formatDateTime(at)}>{relativeSeconds(at, now)}</span>;
}

function Row({ now, row }: { now: number; row: WorkspaceRow }) {
  return (
    <tr>
      <td className="py-2.5">
        <span className="font-medium">{row.name || "Unnamed workspace"}</span>
        <span className="block font-mono text-xs text-zinc-500">{row.slug}</span>
        {row.ownerEmail === null ? null : (
          <span className="block text-xs text-zinc-500">{row.ownerEmail}</span>
        )}
      </td>
      {/* Plan, runs and monitors come from the analytics range, which only
          carries the workspaces that ran something in it. No row there is not
          "zero": it is a number this table does not have. */}
      <td className="py-2.5 text-zinc-500">
        {row.analytics === null ? EM_DASH : planLabel(row.analytics.subscription)}
      </td>
      <td className="py-2.5 tabular-nums">{formatNumber(row.memberCount)}</td>
      <td className="py-2.5 tabular-nums">
        {row.analytics === null ? EM_DASH : formatNumber(row.analytics.runs)}
      </td>
      <td className="py-2.5 tabular-nums">
        {row.analytics === null ? EM_DASH : formatNumber(row.analytics.monitors)}
      </td>
      <td className="py-2.5 whitespace-nowrap text-zinc-500">
        <Ago at={row.lastRunAt} now={now} />
        {row.lastRunStatus === null ? null : (
          <span className="ml-2">
            <StatusBadge label={row.lastRunStatus} />
          </span>
        )}
      </td>
      <td className="py-2.5 whitespace-nowrap text-zinc-500">
        <Ago at={row.lastLoginAt} now={now} />
      </td>
      <td className="py-2.5 whitespace-nowrap text-zinc-500">
        <Ago at={row.lastWebAt} now={now} />
        {" / "}
        <Ago at={row.lastAppAt} now={now} />
      </td>
      <td className="py-2.5 whitespace-nowrap text-zinc-500">
        <Ago at={row.lastAlertSentAt} now={now} />
      </td>
      <td className="py-2.5 whitespace-nowrap text-zinc-500">{formatDate(row.createdAt)}</td>
    </tr>
  );
}

/**
 * What the panel can still say about workspaces before migration 0038 lands:
 * the analytics range on its own, without a single activity column.
 */
function AnalyticsOnlyTable({ now, rows }: { now: number; rows: readonly ActiveWorkspaceRow[] }) {
  if (rows.length === 0) {
    return <p className="text-zinc-500">No workspace ran anything in the last 30 days</p>;
  }
  return (
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
  );
}

export interface WorkspacesTableProps {
  /** The analytics 30-day rows, or undefined while that query is still out. */
  active: ActiveWorkspaceRow[] | undefined;
  now: number;
  workspaces: WorkspacesResponse;
}

/**
 * Every live workspace by what it last did. Two sources meet here: the activity
 * columns (last login, last web/app visit, last run, last alert) and the 30-day
 * analytics counters, joined by workspace id.
 */
export function WorkspacesTable({ active, now, workspaces }: WorkspacesTableProps) {
  if ("unavailable" in workspaces) {
    return (
      <Card aside="Last 30 days" title="Workspaces">
        <p className="mb-3 text-xs font-medium text-warn-600">
          Activity columns pending production migration
        </p>
        <AnalyticsOnlyTable now={now} rows={active ?? []} />
      </Card>
    );
  }

  const rows = joinWorkspaceRows(workspaces.workspaces, active);
  return (
    <Card
      aside={`${formatNumber(rows.length)} workspace${rows.length === 1 ? "" : "s"} · sorted by last activity`}
      title="Workspaces"
    >
      {rows.length === 0 ? (
        <p className="text-zinc-500">No workspaces yet</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="text-xs text-zinc-500">
              <tr>
                <th className="pb-2 font-medium">Workspace</th>
                <th className="pb-2 font-medium">Plan</th>
                <th className="pb-2 font-medium">Members</th>
                <th className="pb-2 font-medium">Runs 30 d</th>
                <th className="pb-2 font-medium">Monitors</th>
                <th className="pb-2 font-medium">Last run</th>
                <th className="pb-2 font-medium">Last login</th>
                <th className="pb-2 font-medium">Last web / app</th>
                <th className="pb-2 font-medium">Last alert</th>
                <th className="pb-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((row) => (
                <Row key={row.id} now={now} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
