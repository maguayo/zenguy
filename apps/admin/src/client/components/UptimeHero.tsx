import { memo } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";

import type { Metrics, UptimeDayPoint } from "../../shared/types";
import { formatNumber } from "../lib/format";
import { isEmptySeries, pct, sumBy } from "../lib/series";
import { countTick, millisTick } from "./charts/axes";
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
} from "./charts/parts";
import { BAR, LINE, PLOT, SERIES, STACK_GAP } from "./charts/theme";
import { HeroSection } from "./HeroSection";
import { KpiWidget } from "./KpiWidget";

const KEYS = [
  { color: SERIES.up, label: "Up" },
  { color: SERIES.down, label: "Down" },
  { color: SERIES.neutral, label: "Resp. media", shape: "line" as const },
];

function rows(day: UptimeDayPoint) {
  const total = day.up + day.down;
  return [
    { color: SERIES.up, label: "Up", value: formatNumber(day.up) },
    { color: SERIES.down, label: "Down", value: formatNumber(day.down) },
    { label: "Uptime", value: total === 0 ? "—" : pct((day.up / total) * 100) },
    {
      color: SERIES.neutral,
      label: "Resp. media",
      shape: "line" as const,
      value: day.avgResponseMs === null ? "—" : `${formatNumber(Math.round(day.avgResponseMs))} ms`,
    },
  ];
}

/** Uptime %, monitors down and open incidents beside the daily check mix. */
export const UptimeHero = memo(function UptimeHero({ uptime }: { uptime: Metrics["uptime"] }) {
  const days = uptime.series.map((point) => point.day);
  const tooltip = <DayTooltip rows={rows} />;
  const up = sumBy(uptime.series, "up");
  const down = sumBy(uptime.series, "down");
  return (
    <HeroSection
      widgets={
        <>
          <KpiWidget hint="checks del rango" label="Uptime" value={pct(uptime.upPercent)} />
          <KpiWidget
            hint={`de ${formatNumber(uptime.monitorsTotal)} activos`}
            label="Monitores down"
            tone={uptime.monitorsDown > 0 ? "danger" : "default"}
            value={formatNumber(uptime.monitorsDown)}
          />
          <KpiWidget
            hint="ahora mismo"
            label="Incidentes abiertos"
            tone={uptime.openIncidents > 0 ? "danger" : "default"}
            value={formatNumber(uptime.openIncidents)}
          />
        </>
      }
      chart={
        <ChartCard
          aside={up + down === 0 ? undefined : `${pct(uptime.upPercent)} up en el rango`}
          empty={isEmptySeries(uptime.series, ["up", "down"]) && "Sin checks en este rango"}
          emptyHeight={PLOT.pairHeight}
          footer={`Up ${formatNumber(up)} · Down ${formatNumber(down)}`}
          keys={KEYS}
          title="Checks por día"
        >
          <PlotPair
            label={`Checks de uptime por día y tiempo de respuesta medio, ${days.length} días`}
            main={
              <BarChart barCategoryGap={PLOT.barCategoryGap} data={uptime.series} margin={PLOT.margin}>
                <CartesianGrid {...gridProps} />
                <XAxis {...hiddenDayAxisProps} />
                <YAxis {...valueAxisProps} {...countTick} />
                <Tooltip content={tooltip} cursor={barCursor} />
                <Bar {...BAR} {...STACK_GAP} dataKey="up" fill={SERIES.up} stackId="checks" />
                <Bar {...BAR} {...STACK_GAP} dataKey="down" fill={SERIES.down} stackId="checks" />
              </BarChart>
            }
            rail={
              <LineChart data={uptime.series} margin={PLOT.margin}>
                <CartesianGrid {...gridProps} />
                <XAxis {...dayAxisProps(days)} />
                <YAxis {...valueAxisProps} {...millisTick} />
                <Tooltip content={tooltip} cursor={lineCursor} />
                <Line {...LINE} dataKey="avgResponseMs" stroke={SERIES.neutral} type="monotone" />
              </LineChart>
            }
          />
        </ChartCard>
      }
    />
  );
});
