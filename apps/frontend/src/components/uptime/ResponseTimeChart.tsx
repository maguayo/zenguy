import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";

import type { MonitorStats } from "../../api/types";
import { formatDateTime, formatTime } from "../../lib/format";
import { Badge } from "../ui/Badge";
import { EmptyState } from "../ui/EmptyState";
import {
  responseTimeChartModel,
  type ResponseTimeChartPoint,
  type ResponseTimeChartModel,
} from "./response-time-chart";

export interface ResponseTimeChartProps {
  /** Exact 24-hour average returned by the stats endpoint. */
  averageMs?: number | null;
  series: MonitorStats["series"];
  timezone: string;
}

function responseTimeLabel(value: number | null): string {
  return value === null ? "No response" : `${Math.round(value)} ms`;
}

function pointCountLabel(count: number): string {
  return `${count} plotted ${count === 1 ? "point" : "points"}`;
}

function ResponseTimeTooltip({
  active,
  payload,
  timezone,
}: TooltipContentProps & { timezone: string }) {
  const point = payload?.find((entry) => entry.payload)?.payload as
    | ResponseTimeChartPoint
    | undefined;
  if (!active || !point) return null;
  const failed = point.status === "FAILED";

  return (
    <div
      aria-live="polite"
      className="min-w-44 rounded-lg border border-zinc-200 bg-white p-3 text-xs shadow-lg"
      role="status"
    >
      <time className="font-medium text-zinc-600" dateTime={point.t}>
        {formatDateTime(point.t, timezone)}
      </time>
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-base font-semibold tabular-nums text-zinc-950">
          {responseTimeLabel(point.responseTimeMs)}
        </span>
        <Badge tone={failed ? "danger" : "ok"}>
          <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
          {failed ? "Failed attempt" : "Passed"}
        </Badge>
      </div>
    </div>
  );
}

function SummaryMetric({ detail, label, value }: { detail: string; label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-zinc-50/90 px-3.5 py-3 ring-1 ring-inset ring-zinc-200">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-zinc-950">{value}</p>
      <p className="mt-0.5 truncate text-[11px] text-zinc-500" title={detail}>{detail}</p>
    </div>
  );
}

function chartAriaLabel(model: ResponseTimeChartModel, timezone: string): string {
  const parts = [
    `Response time over the last 24 hours, ${pointCountLabel(model.points.length)}.`,
  ];
  if (model.latest) {
    parts.push(
      `Latest ${responseTimeLabel(model.latest.responseTimeMs)} at ${formatDateTime(model.latest.t, timezone)}, ${model.latest.status === "FAILED" ? "failed attempt" : "passed"}.`,
    );
  }
  if (model.averageMs !== null) {
    parts.push(`Average ${responseTimeLabel(model.averageMs)}.`);
  }
  parts.push(
    `${model.failedAttempts} failed ${model.failedAttempts === 1 ? "attempt" : "attempts"} in the plotted data.`,
  );
  if (model.noResponseAttempts > 0) {
    parts.push(
      `${model.noResponseAttempts} plotted ${model.noResponseAttempts === 1 ? "point had" : "points had"} no response.`,
    );
  }
  return parts.join(" ");
}

export function ResponseTimeChart({ averageMs, series, timezone }: ResponseTimeChartProps) {
  const model = responseTimeChartModel(series, averageMs, Date.now());
  const latestDetail = model.latest
    ? `${model.latest.status === "FAILED" ? "Failed attempt" : "Passed"} · ${formatTime(model.latest.t, timezone)}`
    : "Waiting for a check";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-zinc-950">Response time</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Last 24 hours · {pointCountLabel(model.points.length)}
          </p>
        </div>
        <div
          aria-label="Chart legend"
          className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-zinc-500"
        >
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-0.5 w-4 rounded-full bg-accent-600" />
            Response time
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2 rounded-full bg-danger-600" />
            Failed attempt
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:max-w-md">
        <SummaryMetric
          detail={latestDetail}
          label="Latest"
          value={model.latest ? responseTimeLabel(model.latest.responseTimeMs) : "—"}
        />
        <SummaryMetric
          detail="Exact 24 h average"
          label="Average"
          value={model.averageMs === null ? "—" : responseTimeLabel(model.averageMs)}
        />
      </div>

      {model.points.length === 0 ? (
        <EmptyState
          className="min-h-52 bg-zinc-50/60"
          description="Response-time measurements will appear after the first scheduled request."
          title="Not enough data yet"
        />
      ) : model.measuredPoints === 0 ? (
        <EmptyState
          className="min-h-52 bg-zinc-50/60"
          description="The plotted attempts did not return a measurable response time."
          title="No response measurements"
        />
      ) : (
        <div
          aria-label={chartAriaLabel(model, timezone)}
          className="h-[230px] w-full"
          role="group"
        >
          <ResponsiveContainer height="100%" width="100%">
            <ComposedChart data={model.points} margin={{ bottom: 0, left: -4, right: 12, top: 12 }}>
              <CartesianGrid stroke="#f4f4f5" strokeDasharray="3 3" vertical={false} />
              <XAxis
                axisLine={false}
                dataKey="timestamp"
                domain={model.timeDomain}
                minTickGap={48}
                scale="time"
                tick={{ fill: "#71717a", fontSize: 11 }}
                tickFormatter={(value: number) => formatTime(new Date(value).toISOString(), timezone)}
                tickLine={false}
                type="number"
              />
              <YAxis
                allowDecimals={false}
                axisLine={false}
                domain={[0, model.axisMax]}
                tick={{ fill: "#71717a", fontSize: 11 }}
                tickCount={4}
                tickFormatter={(value: number) => `${Math.round(value)} ms`}
                tickLine={false}
                width={56}
                padding={{ top: 12 }}
              />
              <ChartTooltip
                content={(props) => <ResponseTimeTooltip {...props} timezone={timezone} />}
                cursor={{ stroke: "#d4d4d8", strokeDasharray: "3 3", strokeWidth: 1 }}
                filterNull={false}
              />
              {model.averageMs !== null ? (
                <ReferenceLine
                  ifOverflow="extendDomain"
                  label={{
                    fill: "#71717a",
                    fontSize: 10,
                    position: "insideTopRight",
                    value: `Avg ${responseTimeLabel(model.averageMs)}`,
                  }}
                  stroke="#a1a1aa"
                  strokeDasharray="5 4"
                  y={model.averageMs}
                />
              ) : null}
              <Area
                activeDot={{ fill: "var(--color-accent-600)", r: 4, stroke: "white", strokeWidth: 2 }}
                connectNulls={false}
                dataKey="responseTimeMs"
                dot={
                  model.measuredPoints === 1
                    ? {
                        fill: "var(--color-accent-600)",
                        r: 4,
                        stroke: "white",
                        strokeWidth: 2,
                      }
                    : false
                }
                fill="var(--color-accent-600)"
                fillOpacity={0.08}
                isAnimationActive={false}
                stroke="var(--color-accent-600)"
                strokeWidth={2}
                type="monotone"
              />
              <Line
                activeDot={false}
                connectNulls={false}
                dataKey="failedResponseTimeMs"
                dot={{ fill: "var(--color-danger-600)", r: 4, stroke: "white", strokeWidth: 2 }}
                isAnimationActive={false}
                stroke="transparent"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
