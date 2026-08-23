import type { MonitorDownRow, Overview } from "../../shared/types";
import { formatElapsed, formatNumber } from "../lib/format";
import { Card } from "./Card";
import { StatusBadge } from "./StatusBadge";

/**
 * Where the uptime monitors stand right now, and which of them are failing.
 *
 * The counts come from `/api/overview` and the list from `/api/analytics`: two
 * queries that answer at different times. `rows` is therefore `undefined` until
 * the second one lands — never an empty array standing in for it, which would
 * print "every monitor is up" next to a DOWN badge.
 */
export function MonitorsCard({
  monitors,
  now,
  rows,
}: {
  monitors: Overview["uptimeMonitors"];
  now: number;
  rows: MonitorDownRow[] | undefined;
}) {
  return (
    <Card aside={`${formatNumber(monitors.total)} total`} title="Monitors">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge label={`UP ${formatNumber(monitors.up)}`} status="UP" />
        <StatusBadge label={`DOWN ${formatNumber(monitors.down)}`} status="DOWN" />
        <StatusBadge label={`UNKNOWN ${formatNumber(monitors.unknown)}`} status="UNKNOWN" />
      </div>
      {rows === undefined ? (
        <p className="mt-3 border-t border-zinc-100 pt-3 text-zinc-500">
          Loading failing monitors…
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-3 border-t border-zinc-100 pt-3 text-zinc-500">Every monitor is up</p>
      ) : (
        <ul className="mt-3 divide-y divide-zinc-100 border-t border-zinc-100">
          {rows.map((row) => (
            <li className="py-2.5" key={row.monitorId}>
              <p className="font-medium text-zinc-900">{row.name}</p>
              <p className="text-xs text-zinc-500">
                {row.workspaceName ?? "Unknown workspace"}
                {" · "}
                {row.since === null
                  ? "down for an unknown time"
                  : `down for ${formatElapsed(now - row.since)}`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
