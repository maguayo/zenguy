import { memo } from "react";
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";

import type { UsersDay } from "../../../shared/types";
import { formatNumber } from "../../lib/format";
import { isEmpty } from "../../lib/series";
import { countTick } from "./axes";
import {
  ChartCard,
  DayTooltip,
  SinglePlot,
  dayAxisProps,
  gridProps,
  lineCursor,
  valueAxisProps,
} from "./parts";
import { INK, LINE, PLOT, SERIES } from "./theme";

const KEYS = [
  { color: SERIES.accent, label: "Signed in that day", shape: "line" as const },
  { color: INK.axis, label: "Trailing 7 days", shape: "line" as const },
];

function rows(day: UsersDay) {
  return [
    {
      color: SERIES.accent,
      label: "Signed in that day",
      shape: "line" as const,
      value: formatNumber(day.dau),
    },
    {
      color: INK.axis,
      label: "Trailing 7 days",
      shape: "line" as const,
      value: day.wau === null ? "not computed" : formatNumber(day.wau),
    },
  ];
}

/**
 * Both lines count people, so they share one axis honestly. The daily figure is
 * the subject and wears the accent; the trailing window is context and stays grey.
 *
 * The server computes the exact trailing 7 day window for the last 14 days of a
 * range only, so on 30 d and 90 d the grey line simply starts late. The aside
 * says so: a line that stops is otherwise read as a metric that collapsed.
 */
export const ActiveUsersChart = memo(function ActiveUsersChart({ users }: { users: UsersDay[] }) {
  return (
    <ChartCard
      aside="Distinct accounts that signed in · the 7 day line only covers the last 14 days"
      empty={isEmpty(users, ["dau"]) && "Nobody signed in during this range"}
      keys={KEYS}
      title="Active users"
    >
      <SinglePlot
        label={`Daily and trailing seven day active accounts, ${users.length} days`}
        chart={
          <LineChart data={users} margin={PLOT.margin}>
            <CartesianGrid {...gridProps} />
            <XAxis {...dayAxisProps(users.map((day) => day.day))} />
            <YAxis {...valueAxisProps} {...countTick} />
            <Tooltip content={<DayTooltip rows={rows} />} cursor={lineCursor} />
            <Line {...LINE} dataKey="wau" stroke={INK.axis} type="monotone" />
            <Line {...LINE} dataKey="dau" stroke={SERIES.accent} type="monotone" />
          </LineChart>
        }
      />
    </ChartCard>
  );
});
