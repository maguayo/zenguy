import { memo } from "react";
import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";

import type { RunsDay } from "../../../shared/types";
import { formatNumber } from "../../lib/format";
import { finishedRuns, hasFallback, isEmpty, runSeries, sumSeries } from "../../lib/series";
import type { RunPoint } from "../../lib/series";
import { countTick, percentTick, ratio } from "./axes";
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
import { BAR, INK, LINE, PLOT, SERIES, STACK_GAP } from "./theme";

/**
 * Bottom to top: the verdict a run can earn, then the two ways it can fail, then
 * the outright failure. Amber never touches red in the stack — those two are the
 * pair a red-green reader would most easily confuse.
 *
 * The zinc cap is not a verdict: it is the runs the day created and has not
 * finished yet. Without it the column stops short of the day's own total and
 * today reads as a collapse rather than as an afternoon still in progress.
 */
const SEGMENTS = [
  { color: SERIES.passed, key: "passed", label: "Passed" },
  { color: SERIES.timeout, key: "timeout", label: "Timeout" },
  { color: SERIES.systemError, key: "systemError", label: "System error" },
  { color: SERIES.failed, key: "failed", label: "Failed" },
  { color: SERIES.inProgress, key: "inProgress", label: "In progress" },
] as const;

function rows(fallback: boolean) {
  return (day: RunPoint) => [
    ...SEGMENTS.map((segment) => ({
      color: segment.color,
      label: segment.label,
      value: formatNumber(day[segment.key]),
    })),
    {
      color: SERIES.accent,
      label: "Pass rate",
      shape: "line" as const,
      value: ratio(day.passRatePct),
    },
    ...(fallback
      ? [
          {
            color: INK.axis,
            label: "On fallback",
            shape: "line" as const,
            value: ratio(day.fallbackPct),
          },
        ]
      : []),
  ];
}

/** Runs per day by verdict, with the rates that verdict mix implies underneath. */
export const RunsChart = memo(function RunsChart({
  footer,
  runs,
}: {
  footer?: ReactNode;
  runs: RunsDay[];
}) {
  const series = runSeries(runs);
  const fallback = hasFallback(runs);
  // Every rate on this card divides by the runs that reached a verdict. `total`
  // counts QUEUED and RUNNING too, and dividing by it would report the pass rate
  // dropping every time a run is queued.
  const totals = {
    failed: sumSeries(runs, "failed"),
    passed: sumSeries(runs, "passed"),
    systemError: sumSeries(runs, "systemError"),
    timeout: sumSeries(runs, "timeout"),
  };
  const finished = finishedRuns(totals);
  const tooltip = <DayTooltip rows={rows(fallback)} />;
  const keys = [
    ...SEGMENTS.map((segment) => ({ color: segment.color, label: segment.label })),
    { color: SERIES.accent, label: "Pass rate", shape: "line" as const },
    ...(fallback ? [{ color: INK.axis, label: "On fallback", shape: "line" as const }] : []),
  ];

  return (
    <ChartCard
      aside={
        finished === 0
          ? undefined
          : `${ratio((totals.passed / finished) * 100)} of ${formatNumber(finished)} finished passed`
      }
      empty={isEmpty(runs, ["total"]) && "No runs in this range"}
      emptyHeight={PLOT.pairHeight}
      footer={
        <>
          <p>
            {SEGMENTS.map(
              (segment) => `${segment.label} ${formatNumber(sumSeries(series, segment.key))}`,
            ).join(" · ")}
          </p>
          {footer === undefined ? null : <p className="mt-1">{footer}</p>}
        </>
      }
      keys={keys}
      title="Browser runs per day"
    >
      <PlotPair
        label={`Browser runs per day by verdict, ${runs.length} days`}
        main={
          <BarChart barCategoryGap={PLOT.barCategoryGap} data={series} margin={PLOT.margin}>
            <CartesianGrid {...gridProps} />
            <XAxis {...hiddenDayAxisProps} />
            <YAxis {...valueAxisProps} {...countTick} />
            <Tooltip content={tooltip} cursor={barCursor} />
            {SEGMENTS.map((segment) => (
              <Bar
                {...BAR}
                {...STACK_GAP}
                dataKey={segment.key}
                fill={segment.color}
                key={segment.key}
                stackId="status"
              />
            ))}
          </BarChart>
        }
        rail={
          <LineChart data={series} margin={PLOT.margin}>
            <CartesianGrid {...gridProps} />
            <XAxis {...dayAxisProps(series.map((day) => day.day))} />
            <YAxis {...valueAxisProps} {...percentTick} />
            <Tooltip content={tooltip} cursor={lineCursor} />
            {fallback ? (
              <Line {...LINE} dataKey="fallbackPct" stroke={INK.axis} type="monotone" />
            ) : null}
            <Line {...LINE} dataKey="passRatePct" stroke={SERIES.accent} type="monotone" />
          </LineChart>
        }
      />
    </ChartCard>
  );
});
