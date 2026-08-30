import { memo } from "react";
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";

import type { CostDayPoint, Costs } from "../../shared/types";
import { formatNumber, relativeSeconds } from "../lib/format";
import { formatUsd } from "../lib/series";
import { Card } from "./Card";
import {
  ChartCard,
  DayTooltip,
  SinglePlot,
  barCursor,
  dayAxisProps,
  gridProps,
  valueAxisProps,
} from "./charts/parts";
import { BAR, PLOT, SERIES, STACK_GAP } from "./charts/theme";
import { HeroSection } from "./HeroSection";
import { KpiWidget } from "./KpiWidget";

/** A collection older than this is a broken cron, whatever its last status said. */
const STALE_AFTER_MS = 2 * 86_400_000;

/** Identity by product, never by rank, so a quiet month never repaints the lines. */
const PRODUCT_COLOR: Record<string, string> = {
  workers: SERIES.accent,
  d1: SERIES.passed,
  do: SERIES.timeout,
  containers: SERIES.failed,
  kv: SERIES.neutral,
  r2: SERIES.accentSoft,
  queues: SERIES.accentDeep,
  email: SERIES.inProgress,
};

function lineColor(key: string): string {
  return PRODUCT_COLOR[key.split(".")[0] ?? ""] ?? SERIES.neutral;
}

const usageFormat = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });

function formatUsage(value: number): string {
  return usageFormat.format(value);
}

const centsTick = {
  tickFormatter: (value: number) => formatUsd(value),
};

function SetupCard() {
  return (
    <Card title="Colector sin configurar">
      <ol className="list-decimal space-y-2 pl-5 text-zinc-700">
        <li>
          Crea un API token en Cloudflare (dash.cloudflare.com → My Profile → API Tokens) con el
          permiso <span className="font-mono">Account · Account Analytics · Read</span> sobre la
          cuenta.
        </li>
        <li>
          Instálalo como secreto del Worker del admin:{" "}
          <span className="font-mono">wrangler secret put CF_ANALYTICS_API_TOKEN</span> desde{" "}
          <span className="font-mono">apps/admin</span>. El cron de las 02:15 UTC empieza a
          recoger solo; esta sección se rellena tras la primera recogida.
        </li>
      </ol>
    </Card>
  );
}

function LinesCard({ lines }: { lines: Costs["lines"] }) {
  const active = lines.filter((line) => line.monthToDate > 0 || line.costCents > 0);
  return (
    <Card
      aside={active.length === lines.length ? undefined : "líneas sin uso ocultas"}
      title="Líneas del mes"
    >
      {active.length === 0 ? (
        <p className="text-zinc-500">Sin uso registrado este mes</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-zinc-500">
              <tr>
                <th className="pb-2 font-medium">Línea</th>
                <th className="pb-2 text-right font-medium">Uso</th>
                <th className="pb-2 text-right font-medium">Incluido</th>
                <th className="pb-2 text-right font-medium">Exceso</th>
                <th className="pb-2 text-right font-medium">Coste</th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {active.map((line) => (
                <tr className="border-t border-zinc-100" key={line.key}>
                  <td className="py-1.5 pr-3 font-sans text-zinc-700">
                    <span
                      aria-hidden
                      className="mr-1.5 inline-block size-2.5 rounded-[2px]"
                      style={{ backgroundColor: lineColor(line.key) }}
                    />
                    {line.label}
                  </td>
                  <td className="py-1.5 text-right">{`${formatUsage(line.monthToDate)} ${line.unit}`}</td>
                  <td className="py-1.5 text-right text-zinc-500">{formatUsage(line.included)}</td>
                  <td className="py-1.5 text-right">{formatUsage(line.overage)}</td>
                  <td className={`py-1.5 text-right ${line.costCents > 0 ? "text-danger-700" : ""}`}>
                    {formatUsd(line.costCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function CollectionCard({
  collection,
  onRefresh,
  refreshError,
  refreshing,
}: {
  collection: Costs["lastCollection"];
  onRefresh: () => void;
  refreshError: string | null;
  refreshing: boolean;
}) {
  return (
    <Card
      aside={
        collection === null
          ? undefined
          : `${collection.source} · ${collection.fromDay} → ${collection.toDay}`
      }
      title="Recogida"
    >
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="h-9 rounded-md border border-zinc-300 bg-white px-3 font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
          disabled={refreshing}
          onClick={onRefresh}
          type="button"
        >
          {refreshing ? "Recogiendo…" : "Actualizar ahora"}
        </button>
        {refreshError === null ? null : <span className="text-danger-700">{refreshError}</span>}
      </div>
      {collection === null ? (
        <p className="mt-3 text-zinc-500">Todavía no se ha recogido nada.</p>
      ) : (
        <ul className="mt-3 space-y-1 font-mono text-xs">
          {collection.probes.map((probe) => (
            <li className="flex items-baseline gap-2" key={probe.probe}>
              <span className={probe.ok ? "text-ok-700" : "text-danger-700"}>
                {probe.ok ? "✓" : "✗"}
              </span>
              <span className="w-28 shrink-0">{probe.probe}</span>
              <span className="text-zinc-500">
                {probe.ok ? `${formatNumber(probe.rows)} filas` : (probe.error ?? "error")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Estimated month, its heaviest line and the collector's health beside the daily marginal cost. */
export const CostsHero = memo(function CostsHero({
  costs,
  now,
  onRefresh,
  refreshError,
  refreshing,
}: {
  costs: Costs;
  now: number;
  onRefresh: () => void;
  refreshError: string | null;
  refreshing: boolean;
}) {
  const labels = new Map(costs.lines.map((line) => [line.key, line.label]));
  const lineKeys = [
    ...new Set(costs.series.flatMap((point) => Object.keys(point.byLine))),
  ].sort();
  const points = costs.series.map((point) => ({ ...point, ...point.byLine }));
  const days = costs.series.map((point) => point.day);
  const collection = costs.lastCollection;
  const collectionStale =
    collection === null ||
    collection.status === "FAILED" ||
    now - collection.startedAt > STALE_AFTER_MS;
  const failedProbes = collection?.probes.filter((probe) => !probe.ok).map((probe) => probe.probe) ?? [];
  const tooltip = (
    <DayTooltip
      rows={(day: CostDayPoint) => [
        ...Object.entries(day.byLine).map(([key, cents]) => ({
          color: lineColor(key),
          label: labels.get(key) ?? key,
          value: formatUsd(cents),
        })),
        { label: "Total", value: formatUsd(day.totalCents) },
      ]}
    />
  );

  return (
    <HeroSection
      widgets={
        <>
          <KpiWidget
            hint={
              costs.collectorConfigured
                ? `proyección ${formatUsd(costs.projectedCents)} · cuota base ${formatUsd(costs.baseFeeCents)}`
                : "sin datos hasta configurar el colector"
            }
            label="Coste estimado (mes)"
            value={costs.collectorConfigured ? formatUsd(costs.totalCents) : "—"}
          />
          <KpiWidget
            hint={costs.topLine === null ? "sin excesos sobre las cuotas" : costs.topLine.label}
            label="Línea más cara"
            value={costs.topLine === null ? "—" : formatUsd(costs.topLine.costCents)}
          />
          <KpiWidget
            hint={
              collection === null
                ? costs.collectorConfigured
                  ? "nunca"
                  : "colector sin configurar"
                : failedProbes.length === 0
                  ? collection.status
                  : `${collection.status} · falla ${failedProbes.join(", ")}`
            }
            label="Última recogida"
            tone={costs.collectorConfigured && collectionStale ? "danger" : "default"}
            value={collection === null ? "—" : relativeSeconds(collection.startedAt, now)}
          />
        </>
      }
      chart={
        costs.collectorConfigured ? (
          <ChartCard
            aside="estimación: precios de lista menos cuotas incluidas"
            empty={
              costs.series.every((point) => point.totalCents === 0) &&
              "Sin coste marginal en el rango: todo dentro de las cuotas incluidas"
            }
            keys={lineKeys.map((key) => ({ color: lineColor(key), label: labels.get(key) ?? key }))}
            title="Coste marginal por día"
          >
            <SinglePlot
              chart={
                <BarChart barCategoryGap={PLOT.barCategoryGap} data={points} margin={PLOT.margin}>
                  <CartesianGrid {...gridProps} />
                  <XAxis {...dayAxisProps(days)} />
                  <YAxis {...valueAxisProps} {...centsTick} />
                  <Tooltip content={tooltip} cursor={barCursor} />
                  {lineKeys.map((key) => (
                    <Bar {...BAR} {...STACK_GAP} dataKey={key} fill={lineColor(key)} key={key} stackId="cost" />
                  ))}
                </BarChart>
              }
              label={`Coste marginal estimado por día y línea, ${days.length} días`}
            />
          </ChartCard>
        ) : (
          <SetupCard />
        )
      }
      footer={
        costs.collectorConfigured ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <LinesCard lines={costs.lines} />
            <CollectionCard
              collection={collection}
              onRefresh={onRefresh}
              refreshError={refreshError}
              refreshing={refreshing}
            />
          </div>
        ) : undefined
      }
    />
  );
});
