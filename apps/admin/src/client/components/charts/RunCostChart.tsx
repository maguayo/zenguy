import { memo } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";

import type { RunsDay } from "../../../shared/types";
import { formatDuration } from "../../lib/format";
import { formatTokens, runSeries, sumSeries } from "../../lib/series";
import type { RunPoint } from "../../lib/series";
import { secondsTick, tokenTick } from "./axes";
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
  { color: SERIES.accentDeep, label: "Input tokens" },
  { color: SERIES.accentSoft, label: "Output tokens" },
  { color: SERIES.neutral, label: "Avg duration", shape: "line" as const },
];

function rows(day: RunPoint) {
  return [
    { color: SERIES.accentDeep, label: "Input tokens", value: formatTokens(day.inputTokens) },
    { color: SERIES.accentSoft, label: "Output tokens", value: formatTokens(day.outputTokens) },
    {
      color: SERIES.neutral,
      label: "Avg duration",
      shape: "line" as const,
      value: formatDuration(day.avgDurationMs),
    },
  ];
}

/**
 * What the browser agent spent to get those verdicts: tokens, and time per run.
 * The two halves are independent measurements — a database that predates 0021
 * has no token columns at all — so an empty token stack drops the top plot and
 * leaves the duration strip standing.
 */
export const RunCostChart = memo(function RunCostChart({ runs }: { runs: RunsDay[] }) {
  const series = runSeries(runs);
  const input = sumSeries(runs, "inputTokens");
  const output = sumSeries(runs, "outputTokens");
  const tokens = input + output;
  const timed = series.some((day) => day.avgDurationSec !== null);
  const tooltip = <DayTooltip rows={rows} />;

  return (
    <ChartCard
      aside={tokens === 0 ? "No LLM usage recorded" : `${formatTokens(tokens)} tokens in this range`}
      empty={tokens === 0 && !timed && "No run cost data in this range"}
      emptyHeight={PLOT.pairHeight}
      footer={`Input ${formatTokens(input)} · Output ${formatTokens(output)}`}
      keys={KEYS}
      title="Run cost"
    >
      <PlotPair
        label={`LLM tokens and average run duration per day, ${runs.length} days`}
        mainEmpty={tokens === 0 ? "No token usage to plot" : undefined}
        main={
          <BarChart barCategoryGap={PLOT.barCategoryGap} data={series} margin={PLOT.margin}>
            <CartesianGrid {...gridProps} />
            <XAxis {...hiddenDayAxisProps} />
            <YAxis {...valueAxisProps} {...tokenTick} />
            <Tooltip content={tooltip} cursor={barCursor} />
            <Bar
              {...BAR}
              {...STACK_GAP}
              dataKey="inputTokens"
              fill={SERIES.accentDeep}
              stackId="tokens"
            />
            <Bar
              {...BAR}
              {...STACK_GAP}
              dataKey="outputTokens"
              fill={SERIES.accentSoft}
              stackId="tokens"
            />
          </BarChart>
        }
        rail={
          <LineChart data={series} margin={PLOT.margin}>
            <CartesianGrid {...gridProps} />
            <XAxis {...dayAxisProps(series.map((day) => day.day))} />
            <YAxis {...valueAxisProps} {...secondsTick} />
            <Tooltip content={tooltip} cursor={lineCursor} />
            <Line {...LINE} dataKey="avgDurationSec" stroke={SERIES.neutral} type="monotone" />
          </LineChart>
        }
      />
    </ChartCard>
  );
});
