import { memo } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";

import type { UsersDay } from "../../../shared/types";
import { formatNumber, formatSigned } from "../../lib/format";
import { isEmpty, periodDelta, sumSeries } from "../../lib/series";
import { countTick } from "./axes";
import {
  ChartCard,
  DayTooltip,
  PlotPair,
  barCursor,
  dayAxisProps,
  gridProps,
  hiddenDayAxisProps,
  lineCursor,
  valueAxisProps,
} from "./parts";
import { BAR, LINE, PLOT, SERIES } from "./theme";

const KEYS = [
  { color: SERIES.accent, label: "Total accounts", shape: "line" as const },
  { color: SERIES.accent, label: "New sign-ups" },
];

function rows(day: UsersDay) {
  return [
    {
      color: SERIES.accent,
      label: "Total accounts",
      shape: "line" as const,
      value: formatNumber(day.cumulative),
    },
    { color: SERIES.accent, label: "New sign-ups", value: formatNumber(day.signups) },
  ];
}

/**
 * The account base and what added to it, as two plots over one set of days. They
 * are deliberately not one dual-axis chart: a shared plot area would invent a
 * relationship between a five-digit total and a single-digit daily count.
 */
export const UsersChart = memo(function UsersChart({ users }: { users: UsersDay[] }) {
  const days = users.map((day) => day.day);
  const signups = sumSeries(users, "signups");
  const week = periodDelta(users, "signups", 7);
  const tooltip = <DayTooltip rows={rows} />;

  return (
    <ChartCard
      aside={`${formatNumber(signups)} new in this range`}
      empty={isEmpty(users, ["cumulative", "signups"]) && "No accounts in this range"}
      emptyHeight={PLOT.pairHeight}
      footer={
        week.comparable
          ? `${formatNumber(week.current)} sign-ups in the last 7 days · ${formatSigned(week.change)} against the 7 before`
          : `${formatNumber(week.current)} sign-ups in the last 7 days`
      }
      keys={KEYS}
      title="Users"
    >
      <PlotPair
        label={`Total accounts and new sign-ups per day, ${users.length} days`}
        main={
          <AreaChart data={users} margin={PLOT.margin}>
            <CartesianGrid {...gridProps} />
            <XAxis {...hiddenDayAxisProps} />
            <YAxis {...valueAxisProps} {...countTick} />
            <Tooltip content={tooltip} cursor={lineCursor} />
            <Area
              {...LINE}
              dataKey="cumulative"
              fill={SERIES.accent}
              fillOpacity={0.1}
              stroke={SERIES.accent}
              type="monotone"
            />
          </AreaChart>
        }
        rail={
          <BarChart barCategoryGap={PLOT.barCategoryGap} data={users} margin={PLOT.margin}>
            <CartesianGrid {...gridProps} />
            <XAxis {...dayAxisProps(days)} />
            <YAxis {...valueAxisProps} {...countTick} />
            <Tooltip content={tooltip} cursor={barCursor} />
            <Bar {...BAR} dataKey="signups" fill={SERIES.accent} radius={[3, 3, 0, 0]} />
          </BarChart>
        }
      />
    </ChartCard>
  );
});
