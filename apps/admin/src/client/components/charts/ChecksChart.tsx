import { memo } from "react";
import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";

import type { ChecksDay } from "../../../shared/types";
import { formatNumber } from "../../lib/format";
import { isEmpty, sumSeries, uptimePct } from "../../lib/series";
import { countTick, millisTick, ratio } from "./axes";
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
import { BAR, LINE, PLOT, SERIES, STACK_GAP } from "./theme";

const KEYS = [
  { color: SERIES.up, label: "Up" },
  { color: SERIES.down, label: "Down" },
  { color: SERIES.neutral, label: "Avg response", shape: "line" as const },
];

function rows(day: ChecksDay) {
  return [
    { color: SERIES.up, label: "Up", value: formatNumber(day.up) },
    { color: SERIES.down, label: "Down", value: formatNumber(day.down) },
    { label: "Uptime", value: ratio(uptimePct(day)) },
    {
      color: SERIES.neutral,
      label: "Avg response",
      shape: "line" as const,
      value: day.avgResponseMs === null ? "—" : `${formatNumber(day.avgResponseMs)} ms`,
    },
  ];
}

/** Every uptime check of the day, and how quickly the monitored hosts answered. */
export const ChecksChart = memo(function ChecksChart({
  checks,
  footer,
}: {
  checks: ChecksDay[];
  footer?: ReactNode;
}) {
  const up = sumSeries(checks, "up");
  const down = sumSeries(checks, "down");
  const tooltip = <DayTooltip rows={rows} />;

  return (
    <ChartCard
      aside={up + down === 0 ? undefined : `${ratio(uptimePct({ down, up }))} up in this range`}
      empty={isEmpty(checks, ["up", "down"]) && "No checks in this range"}
      emptyHeight={PLOT.pairHeight}
      footer={
        <>
          <p>{`Up ${formatNumber(up)} · Down ${formatNumber(down)}`}</p>
          {footer === undefined ? null : <p className="mt-1">{footer}</p>}
        </>
      }
      keys={KEYS}
      title="Checks per day"
    >
      <PlotPair
        label={`Uptime checks per day and average response time, ${checks.length} days`}
        main={
          <BarChart barCategoryGap={PLOT.barCategoryGap} data={checks} margin={PLOT.margin}>
            <CartesianGrid {...gridProps} />
            <XAxis {...hiddenDayAxisProps} />
            <YAxis {...valueAxisProps} {...countTick} />
            <Tooltip content={tooltip} cursor={barCursor} />
            <Bar {...BAR} {...STACK_GAP} dataKey="up" fill={SERIES.up} stackId="checks" />
            <Bar {...BAR} {...STACK_GAP} dataKey="down" fill={SERIES.down} stackId="checks" />
          </BarChart>
        }
        rail={
          <LineChart data={checks} margin={PLOT.margin}>
            <CartesianGrid {...gridProps} />
            <XAxis {...dayAxisProps(checks.map((day) => day.day))} />
            <YAxis {...valueAxisProps} {...millisTick} />
            <Tooltip content={tooltip} cursor={lineCursor} />
            <Line {...LINE} dataKey="avgResponseMs" stroke={SERIES.neutral} type="monotone" />
          </LineChart>
        }
      />
    </ChartCard>
  );
});
