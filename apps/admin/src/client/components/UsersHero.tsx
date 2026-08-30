import { memo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type {
  Metrics,
  ProductUsage,
  ProductUsageDayPoint,
  ProductUsageSlice,
  Unavailable,
  UsersDayPoint,
} from "../../shared/types";
import { formatNumber, percent } from "../lib/format";
import { countTick } from "./charts/axes";
import {
  ChartCard,
  DayTooltip,
  PlotPair,
  SinglePlot,
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

const USAGE_KEYS = [
  { color: SERIES.accent, label: "Total", shape: "line" as const },
  { color: SERIES.neutral, label: "Web", shape: "line" as const },
  { color: SERIES.accentSoft, label: "App nativa", shape: "line" as const },
];

function usageRows(day: ProductUsageDayPoint) {
  return [
    { color: SERIES.accent, label: "Total", shape: "line" as const, value: formatNumber(day.activeUsers) },
    { color: SERIES.neutral, label: "Web", shape: "line" as const, value: formatNumber(day.webActiveUsers) },
    { color: SERIES.accentSoft, label: "App nativa", shape: "line" as const, value: formatNumber(day.appActiveUsers) },
  ];
}

function average(value: number | null): string {
  return value === null ? "—" : value.toFixed(1);
}

function sourceRow(label: string, slice: ProductUsageSlice) {
  return (
    <tr className="border-t border-zinc-100" key={label}>
      <th className="py-2 pr-3 text-left font-medium text-zinc-700" scope="row">{label}</th>
      <td className="px-3 py-2 text-right font-mono tabular-nums">{formatNumber(slice.activeUsers)}</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">{formatNumber(slice.dau)}</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">{formatNumber(slice.wau)}</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">{formatNumber(slice.mau)}</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">{percent(slice.dauMau)}</td>
      <td className="py-2 pl-3 text-right font-mono tabular-nums">{average(slice.visitsPerActiveUser)}</td>
    </tr>
  );
}

function ProductUsagePanel({ usage }: { usage: ProductUsage | Unavailable }) {
  if ("unavailable" in usage) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500">
        Uso autenticado pendiente: la base enlazada todavía no tiene la migración de activity_events.
      </div>
    );
  }

  const days = usage.series.map((point) => point.day);
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.85fr)]">
      <ChartCard
        empty={usage.overall.mau === 0 && "Sin actividad autenticada todavía"}
        footer={`Ventanas y días en ${usage.timezone} · hoy es parcial`}
        keys={USAGE_KEYS}
        title="Cuentas activas por día"
      >
        <SinglePlot
          label={`Cuentas activas por día y fuente, ${days.length} días`}
          chart={
            <LineChart data={usage.series} margin={PLOT.margin}>
              <CartesianGrid {...gridProps} />
              <XAxis {...dayAxisProps(days)} />
              <YAxis {...valueAxisProps} {...countTick} />
              <Tooltip content={<DayTooltip rows={usageRows} />} cursor={lineCursor} />
              <Line {...LINE} dataKey="activeUsers" stroke={SERIES.accent} type="monotone" />
              <Line {...LINE} dataKey="webActiveUsers" stroke={SERIES.neutral} type="monotone" />
              <Line {...LINE} dataKey="appActiveUsers" stroke={SERIES.accentSoft} type="monotone" />
            </LineChart>
          }
        />
      </ChartCard>

      <div className="rounded-lg border border-zinc-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-zinc-900">Uso autenticado del producto</h3>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5 xl:grid-cols-3">
          {[
            ["Product DAU", formatNumber(usage.overall.dau)],
            ["Product WAU", formatNumber(usage.overall.wau)],
            ["Product MAU", formatNumber(usage.overall.mau)],
            ["DAU / MAU", percent(usage.overall.dauMau)],
            ["Visitas / cuenta", average(usage.overall.visitsPerActiveUser)],
          ].map(([label, value]) => (
            <div className="rounded-md bg-zinc-50 px-3 py-2" key={label}>
              <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase">{label}</p>
              <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-zinc-900">{value}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 overflow-x-auto text-xs text-zinc-600">
          <table className="w-full min-w-[34rem]">
            <thead className="text-zinc-500">
              <tr>
                <th className="pb-2 pr-3 text-left font-medium">Fuente</th>
                <th className="px-3 pb-2 text-right font-medium">Activos rango</th>
                <th className="px-3 pb-2 text-right font-medium">DAU</th>
                <th className="px-3 pb-2 text-right font-medium">WAU</th>
                <th className="px-3 pb-2 text-right font-medium">MAU</th>
                <th className="px-3 pb-2 text-right font-medium">DAU/MAU</th>
                <th className="pb-2 pl-3 text-right font-medium">Visitas/cuenta</th>
              </tr>
            </thead>
            <tbody>
              {sourceRow("Total", usage.overall)}
              {sourceRow("Web", usage.bySource.web)}
              {sourceRow("App nativa", usage.bySource.app)}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs leading-5 text-zinc-500">
          Cuenta activa = user_id con un evento permitido de autenticación, apertura o navegación, en Web o App nativa.
          Se excluyen API, server y cualquier tipo no revisado. Total deduplica las cuentas que usaron ambas superficies,
          por lo que las filas de fuente pueden solaparse. Activos rango y visitas/cuenta usan el rango seleccionado.
        </p>
      </div>
    </div>
  );
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
      footer={<ProductUsagePanel usage={users.productUsage} />}
    />
  );
});
