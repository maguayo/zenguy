import { memo } from "react";
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";

import type { IncidentsDay } from "../../../shared/types";
import { formatNumber } from "../../lib/format";
import { isEmpty, sumSeries } from "../../lib/series";
import { countTick } from "./axes";
import {
  ChartCard,
  DayTooltip,
  SinglePlot,
  barCursor,
  dayAxisProps,
  gridProps,
  valueAxisProps,
} from "./parts";
import { BAR, PLOT, SERIES } from "./theme";

const KEYS = [
  { color: SERIES.opened, label: "Opened" },
  { color: SERIES.resolved, label: "Resolved" },
];

function rows(day: IncidentsDay) {
  return [
    { color: SERIES.opened, label: "Opened", value: formatNumber(day.opened) },
    { color: SERIES.resolved, label: "Resolved", value: formatNumber(day.resolved) },
  ];
}

/**
 * Opened against resolved, side by side rather than stacked: the question is
 * whether the day closed what it opened, and a stack would hide exactly that.
 */
export const IncidentsChart = memo(function IncidentsChart({
  incidents,
}: {
  incidents: IncidentsDay[];
}) {
  const opened = sumSeries(incidents, "opened");
  const resolved = sumSeries(incidents, "resolved");

  return (
    <ChartCard
      aside={`${formatNumber(opened)} opened · ${formatNumber(resolved)} resolved`}
      empty={isEmpty(incidents, ["opened", "resolved"]) && "No incidents in this range"}
      keys={KEYS}
      title="Incidents"
    >
      <SinglePlot
        label={`Incidents opened and resolved per day, ${incidents.length} days`}
        chart={
          <BarChart
            barCategoryGap={PLOT.barCategoryGap}
            barGap={2}
            data={incidents}
            margin={PLOT.margin}
          >
            <CartesianGrid {...gridProps} />
            <XAxis {...dayAxisProps(incidents.map((day) => day.day))} />
            <YAxis {...valueAxisProps} {...countTick} />
            <Tooltip content={<DayTooltip rows={rows} />} cursor={barCursor} />
            <Bar {...BAR} dataKey="opened" fill={SERIES.opened} radius={[3, 3, 0, 0]} />
            <Bar {...BAR} dataKey="resolved" fill={SERIES.resolved} radius={[3, 3, 0, 0]} />
          </BarChart>
        }
      />
    </ChartCard>
  );
});
