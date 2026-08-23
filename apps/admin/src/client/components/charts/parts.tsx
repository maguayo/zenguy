import type { ReactElement, ReactNode } from "react";
import { ResponsiveContainer } from "recharts";
import type { XAxisTickContentProps } from "recharts";

import { formatDayLabel, formatDayTick } from "../../lib/series";
import { Card } from "../Card";
import { AXIS_TICK, INK, PLOT, SERIES } from "./theme";

export type KeyShape = "bar" | "line";

export interface LegendKey {
  color: string;
  label: string;
  shape?: KeyShape;
}

/** Legends mirror the mark: a swatch for a fill, a stroke for a line. */
function Key({ color, shape = "bar" }: { color: string; shape?: KeyShape }) {
  const className =
    shape === "line" ? "inline-block h-0.5 w-3 rounded-full" : "inline-block size-2.5 rounded-[2px]";
  return <span aria-hidden className={className} style={{ backgroundColor: color }} />;
}

/**
 * Identity is never colour alone: every chart with more than one series carries
 * this row, and the card footer repeats the same numbers as text.
 */
export function ChartLegend({ keys }: { keys: readonly LegendKey[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {keys.map((key) => (
        <li className="flex items-center gap-1.5 text-xs text-zinc-500" key={key.label}>
          <Key color={key.color} shape={key.shape} />
          {key.label}
        </li>
      ))}
    </ul>
  );
}

export interface TooltipRow {
  color?: string;
  label: string;
  shape?: KeyShape;
  value: string;
}

interface DayTooltipProps<T> {
  active?: boolean;
  payload?: readonly { payload?: unknown }[];
  /** Every series at that day, with units — the hover never has to find a mark. */
  rows: (datum: T) => TooltipRow[];
}

/**
 * One readout for the whole day. Both plots of a paired chart use the same rows,
 * so hovering either half answers the same question.
 */
export function DayTooltip<T extends { day: string }>({
  active,
  payload,
  rows,
}: DayTooltipProps<T>) {
  const datum = payload?.[0]?.payload as T | undefined;
  if (active !== true || datum === undefined) return null;
  return (
    <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 shadow-sm">
      <p className="mb-1.5 font-mono text-xs text-zinc-500">{formatDayLabel(datum.day)}</p>
      <dl className="space-y-1">
        {rows(datum).map((row) => (
          <div className="flex items-baseline justify-between gap-6" key={row.label}>
            <dt className="flex items-center gap-1.5 text-xs text-zinc-500">
              {row.color === undefined ? null : <Key color={row.color} shape={row.shape} />}
              {row.label}
            </dt>
            <dd className="font-mono text-xs font-medium text-zinc-900 tabular-nums">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * At most `max` labelled days, always counting back from the last one, so the
 * partial day at the right edge is never the tick that gets dropped.
 */
export function tickDays(days: readonly string[], max = 8): string[] {
  if (days.length <= max) return [...days];
  const step = Math.ceil(days.length / max);
  const picked: string[] = [];
  for (let index = days.length - 1; index >= 0; index -= step) picked.unshift(days[index] as string);
  return picked;
}

/**
 * The last day of every range is today, and today is still running. Naming it
 * stops the half-height bar at the right edge from reading as a collapse.
 */
function dayTick(today: string) {
  return function DayTick(props: XAxisTickContentProps): ReactNode {
    const value = String(props.payload.value ?? "");
    const isToday = value === today;
    return (
      <text
        dy={12}
        fill={isToday ? SERIES.accent : INK.axis}
        fontFamily={AXIS_TICK.fontFamily}
        fontSize={AXIS_TICK.fontSize}
        fontWeight={isToday ? 500 : 400}
        textAnchor="middle"
        x={props.x}
        y={props.y}
      >
        {isToday ? "today" : formatDayTick(value)}
      </text>
    );
  };
}

/**
 * The x axis of the plot that carries the labels — always the bottom one.
 *
 * `scale="band"` is load-bearing, not decoration. recharts defaults a category
 * axis to a point scale on a line or area chart and to a band scale on a bar
 * chart, and the two place the same day half a band apart — about 36 px at 7 d,
 * which is most of a column. Both plots of a `PlotPair` therefore declare the
 * band scale explicitly: recharts then offsets line points by bandSize / 2, so
 * a line lands on the centre of the bar below it.
 */
export function dayAxisProps(days: readonly string[]) {
  return {
    axisLine: { stroke: INK.grid },
    dataKey: "day",
    interval: 0 as const,
    scale: "band" as const,
    tick: dayTick(days[days.length - 1] ?? ""),
    tickLine: false,
    tickMargin: 4,
    ticks: tickDays(days),
  };
}

/**
 * The x axis of the plot that does *not* carry the labels — the main plot of a
 * pair. Same scale as the rail below it, or the two drift apart.
 */
export const hiddenDayAxisProps = {
  dataKey: "day" as const,
  hide: true as const,
  scale: "band" as const,
};

export const valueAxisProps = {
  axisLine: false as const,
  tick: AXIS_TICK,
  tickLine: false as const,
  width: PLOT.yWidth,
};

export const gridProps = {
  stroke: INK.grid,
  strokeWidth: 1,
  vertical: false as const,
};

/** A hovered day lifts under a zinc wash rather than a heavy cursor line. */
export const barCursor = { fill: "#fafafa" } as const;

export const lineCursor = { stroke: INK.grid, strokeWidth: 1 } as const;

/** A box the size of a plot, for the half of a card that has nothing to draw. */
export function PlotPlaceholder({ height, message }: { height: number; message: string }) {
  return (
    <div
      className="flex items-center justify-center rounded-md bg-zinc-50 text-zinc-500"
      style={{ height }}
    >
      {message}
    </div>
  );
}

/**
 * A main plot over its companion strip. They are two charts with two y scales
 * that never share a plot area — the alignment comes from identical margins, an
 * identical `YAxis` width and the same band scale on both day axes, so the strip
 * reads as the same days rather than the same numbers.
 *
 * `mainEmpty` drops the main plot only: a card whose measure is missing still
 * owes the reader the strip, which is usually a different measure entirely.
 */
export function PlotPair({
  label,
  main,
  mainEmpty,
  rail,
}: {
  label: string;
  main: ReactElement;
  mainEmpty?: string;
  rail: ReactElement;
}) {
  return (
    <div aria-label={label} className="space-y-1" role="img">
      {mainEmpty === undefined ? (
        <ResponsiveContainer height={PLOT.mainHeight} width="100%">
          {main}
        </ResponsiveContainer>
      ) : (
        <PlotPlaceholder height={PLOT.mainHeight} message={mainEmpty} />
      )}
      <ResponsiveContainer height={PLOT.railHeight} width="100%">
        {rail}
      </ResponsiveContainer>
    </div>
  );
}

export function SinglePlot({ chart, label }: { chart: ReactElement; label: string }) {
  return (
    <div aria-label={label} role="img">
      <ResponsiveContainer height={PLOT.singleHeight} width="100%">
        {chart}
      </ResponsiveContainer>
    </div>
  );
}

export interface ChartCardProps {
  aside?: ReactNode;
  children: ReactNode;
  /** The message to show instead of an empty axis box when nothing happened. */
  empty?: string | false;
  /** The height of the plot being replaced — `PLOT.pairHeight` for a pair. */
  emptyHeight?: number;
  footer?: ReactNode;
  keys?: readonly LegendKey[];
  title: string;
}

export function ChartCard({
  aside,
  children,
  empty,
  emptyHeight = PLOT.singleHeight,
  footer,
  keys,
  title,
}: ChartCardProps) {
  return (
    <Card aside={aside} title={title}>
      {empty === undefined || empty === false ? (
        <>
          {keys === undefined ? null : (
            <div className="mb-2">
              <ChartLegend keys={keys} />
            </div>
          )}
          {children}
        </>
      ) : (
        // The card must not resize when its data does: a placeholder stands as
        // tall as the plot it replaced.
        <PlotPlaceholder height={emptyHeight} message={empty} />
      )}
      {footer === undefined ? null : (
        <div className="mt-3 border-t border-zinc-100 pt-3 text-xs text-zinc-500">{footer}</div>
      )}
    </Card>
  );
}
