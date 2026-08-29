import { memo } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";

import type { Metrics, UsersDayPoint } from "../../shared/types";
import { formatNumber } from "../lib/format";
import { countTick } from "./charts/axes";
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
import { BAR, LINE, PLOT, SERIES } from "./charts/theme";
import { HeroSection } from "./HeroSection";
import { KpiWidget } from "./KpiWidget";

const KEYS = [
  { color: SERIES.accent, label: "Total acumulado", shape: "line" as const },
  { color: SERIES.accentSoft, label: "Altas del día" },
];

function rows(day: UsersDayPoint) {
  return [
    {
      color: SERIES.accent,
      label: "Total",
      shape: "line" as const,
      value: formatNumber(day.cumulative),
    },
    { color: SERIES.accentSoft, label: "Altas", value: formatNumber(day.signups) },
  ];
}

/** Registered / active / danger on the left, the account curve on the right. */
export const UsersHero = memo(function UsersHero({ users }: { users: Metrics["users"] }) {
  const days = users.series.map((point) => point.day);
  const tooltip = <DayTooltip rows={rows} />;
  return (
    <HeroSection
      widgets={
        <>
          <KpiWidget
            hint={`+${formatNumber(users.newInRange)} en el rango`}
            label="Usuarios registrados"
            value={formatNumber(users.registered)}
          />
          <KpiWidget
            hint="con actividad en 7 días"
            label="Usuarios activos"
            value={formatNumber(users.active7d)}
          />
          <KpiWidget
            hint="14+ días sin señales"
            label="Usuarios danger"
            tone={users.danger > 0 ? "danger" : "default"}
            value={formatNumber(users.danger)}
          />
        </>
      }
      chart={
        <ChartCard
          empty={users.registered === 0 && "Sin usuarios todavía"}
          emptyHeight={PLOT.pairHeight}
          footer={`Registrados ${formatNumber(users.registered)} · Altas en el rango ${formatNumber(users.newInRange)}`}
          keys={KEYS}
          title="Evolución de usuarios"
        >
          <PlotPair
            label={`Usuarios acumulados y altas por día, ${days.length} días`}
            main={
              <AreaChart data={users.series} margin={PLOT.margin}>
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
              <BarChart barCategoryGap={PLOT.barCategoryGap} data={users.series} margin={PLOT.margin}>
                <CartesianGrid {...gridProps} />
                <XAxis {...dayAxisProps(days)} />
                <YAxis {...valueAxisProps} {...countTick} />
                <Tooltip content={tooltip} cursor={barCursor} />
                <Bar {...BAR} dataKey="signups" fill={SERIES.accentSoft} />
              </BarChart>
            }
          />
        </ChartCard>
      }
    />
  );
});
