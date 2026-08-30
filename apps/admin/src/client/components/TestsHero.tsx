import { memo } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";

import type { Metrics } from "../../shared/types";
import { formatNumber } from "../lib/format";
import { formatUsd, isEmptySeries, pct, retriesShares, sumBy, testsPoints } from "../lib/series";
import type { TestPoint } from "../lib/series";
import { countTick, percentTick } from "./charts/axes";
import { Card } from "./Card";
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

/**
 * Bottom to top: the verdict a run can earn, then the two ways the platform can
 * fail it, then the outright failure, then the zinc cap of runs still in flight.
 * Amber never touches red in the stack.
 */
const SEGMENTS = [
  { color: SERIES.passed, key: "passed", label: "Pasados" },
  { color: SERIES.timeout, key: "timeout", label: "Timeout" },
  { color: SERIES.systemError, key: "systemError", label: "Error sistema" },
  { color: SERIES.failed, key: "failed", label: "Fallidos" },
  { color: SERIES.inProgress, key: "inProgress", label: "En curso" },
] as const;

const KEYS = [
  ...SEGMENTS.map((segment) => ({ color: segment.color, label: segment.label })),
  { color: SERIES.accent, label: "Pass rate", shape: "line" as const },
];

const RETRY_COLOR: Record<string, string> = {
  first: SERIES.passed,
  second: SERIES.timeout,
  thirdPlus: SERIES.failed,
};

function rows(day: TestPoint) {
  return [
    ...SEGMENTS.map((segment) => ({
      color: segment.color,
      label: segment.label,
      value: formatNumber(day[segment.key]),
    })),
    { color: SERIES.accent, label: "Pass rate", shape: "line" as const, value: pct(day.passRatePct) },
  ];
}

/** Share of passing runs by the attempt that passed, as text plus one thin bar. */
function RetriesCard({ retries }: { retries: Metrics["tests"]["retries"] }) {
  const shares = retriesShares(retries);
  const total = retries.first + retries.second + retries.thirdPlus;
  return (
    <Card aside={total === 0 ? undefined : `${formatNumber(total)} runs pasados`} title="Reintentos (rango)">
      {total === 0 ? (
        <p className="text-zinc-500">Sin runs pasados en este rango</p>
      ) : (
        <>
          <div aria-hidden className="flex h-2 overflow-hidden rounded-full bg-zinc-100">
            {shares.map((share) =>
              share.sharePct === 0 ? null : (
                <div
                  key={share.key}
                  style={{ backgroundColor: RETRY_COLOR[share.key], width: `${share.sharePct}%` }}
                />
              ),
            )}
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-3">
            {shares.map((share) => (
              <div key={share.key}>
                <dt className="flex items-center gap-1.5 text-xs text-zinc-500">
                  <span
                    aria-hidden
                    className="inline-block size-2.5 rounded-[2px]"
                    style={{ backgroundColor: RETRY_COLOR[share.key] }}
                  />
                  {`A la ${share.label}`}
                </dt>
                <dd className="mt-0.5 font-mono text-sm font-medium tabular-nums">
                  {`${pct(share.sharePct)} · ${formatNumber(share.count)}`}
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </Card>
  );
}

/** Estimated LLM spend in fixed windows, independent of the range selector. */
function SpendCard({ spendCents }: { spendCents: Metrics["tests"]["spendCents"] }) {
  const windows = [
    { label: "Hoy", value: spendCents.today },
    { label: "7 días", value: spendCents.last7d },
    { label: "30 días", value: spendCents.last30d },
  ];
  return (
    <Card
      aside="tokens × precio de lista por modelo, sin descuento de caché (al alza)"
      title="Gasto estimado (LLM)"
    >
      <dl className="grid grid-cols-3 gap-3">
        {windows.map((window) => (
          <div key={window.label}>
            <dt className="text-xs text-zinc-500">{window.label}</dt>
            <dd className="mt-0.5 font-mono text-lg font-semibold tabular-nums">
              {formatUsd(window.value)}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/** Totals / per-user / recent failures, the daily verdict mix, retries and spend. */
export const TestsHero = memo(function TestsHero({ tests }: { tests: Metrics["tests"] }) {
  const series = testsPoints(tests.series);
  const days = series.map((point) => point.day);
  const tooltip = <DayTooltip rows={rows} />;
  const finished =
    sumBy(series, "passed") + sumBy(series, "failed") + sumBy(series, "timeout") + sumBy(series, "systemError");
  const passed = sumBy(series, "passed");
  return (
    <HeroSection
      widgets={
        <>
          <KpiWidget hint="en el rango" label="Tests totales" value={formatNumber(tests.total)} />
          <KpiWidget
            hint="usuarios con tests en el rango"
            label="Tests por usuario"
            value={tests.perUser === null ? "—" : tests.perUser.toFixed(1)}
          />
          <KpiWidget
            hint="FAILED + TIMEOUT + ERROR"
            label="Fallidos (2h)"
            tone={tests.failed2h > 0 ? "danger" : "default"}
            value={formatNumber(tests.failed2h)}
          />
        </>
      }
      chart={
        <ChartCard
          aside={
            finished === 0
              ? undefined
              : `${pct((passed / finished) * 100)} de ${formatNumber(finished)} terminados pasaron`
          }
          empty={isEmptySeries(series, ["total"]) && "Sin runs en este rango"}
          emptyHeight={PLOT.pairHeight}
          footer={SEGMENTS.map(
            (segment) => `${segment.label} ${formatNumber(sumBy(series, segment.key))}`,
          ).join(" · ")}
          keys={KEYS}
          title="Tests por día"
        >
          <PlotPair
            label={`Runs por día y veredicto, ${days.length} días`}
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
                <XAxis {...dayAxisProps(days)} />
                <YAxis {...valueAxisProps} {...percentTick} />
                <Tooltip content={tooltip} cursor={lineCursor} />
                <Line {...LINE} dataKey="passRatePct" stroke={SERIES.accent} type="monotone" />
              </LineChart>
            }
          />
        </ChartCard>
      }
      footer={
        <div className="grid gap-4 sm:grid-cols-2">
          <RetriesCard retries={tests.retries} />
          <SpendCard spendCents={tests.spendCents} />
        </div>
      }
    />
  );
});
