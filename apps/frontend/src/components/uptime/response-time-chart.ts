import type { MonitorStats } from "../../api/types";

export type ResponseTimeSeriesPoint = MonitorStats["series"][number];

export interface ResponseTimeChartPoint extends ResponseTimeSeriesPoint {
  /** Only failed attempts with a real measurement are plotted as red points. */
  failedResponseTimeMs: number | null;
  timestamp: number;
}

export interface ResponseTimeChartModel {
  averageMs: number | null;
  axisMax: number;
  failedAttempts: number;
  latest: ResponseTimeChartPoint | null;
  measuredPoints: number;
  noResponseAttempts: number;
  points: ResponseTimeChartPoint[];
  timeDomain: [number, number];
}

const fallbackAxisMax = 100;
const dayMs = 24 * 60 * 60 * 1_000;

function validResponseTime(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value >= 0 ? value : null;
}

function validAverage(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

/** Round an observed maximum up to a compact 1, 2 or 5 × 10ⁿ chart ceiling. */
export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallbackAxisMax;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

/**
 * Normalise API points for a real temporal x-axis. Invalid timestamps are
 * omitted; response-time gaps remain null and are never moved to the baseline.
 */
export function responseTimeChartModel(
  series: ResponseTimeSeriesPoint[],
  averageMs?: number | null,
  windowEndMs?: number,
): ResponseTimeChartModel {
  const points = series
    .flatMap((point): ResponseTimeChartPoint[] => {
      const timestamp = Date.parse(point.t);
      if (!Number.isFinite(timestamp)) return [];
      const responseTimeMs = validResponseTime(point.responseTimeMs);
      return [
        {
          ...point,
          failedResponseTimeMs:
            point.status === "FAILED" && responseTimeMs !== null ? responseTimeMs : null,
          responseTimeMs,
          timestamp,
        },
      ];
    })
    .sort((left, right) => left.timestamp - right.timestamp);
  const exactAverage = validAverage(averageMs);
  const measured = points.flatMap((point) =>
    point.responseTimeMs === null ? [] : [point.responseTimeMs],
  );
  const observedMax = Math.max(0, exactAverage ?? 0, ...measured);
  const firstTimestamp = points[0]?.timestamp ?? 0;
  const lastTimestamp = points.at(-1)?.timestamp ?? firstTimestamp;
  const requestedWindowEnd =
    windowEndMs !== undefined && Number.isFinite(windowEndMs)
      ? windowEndMs
      : lastTimestamp;
  const domainEnd = Math.max(requestedWindowEnd, lastTimestamp);
  const timeDomain: [number, number] = [domainEnd - dayMs, domainEnd];

  return {
    averageMs: exactAverage,
    axisMax: niceMax(observedMax),
    failedAttempts: points.filter((point) => point.status === "FAILED").length,
    latest: points.at(-1) ?? null,
    measuredPoints: measured.length,
    noResponseAttempts: points.filter((point) => point.responseTimeMs === null).length,
    points,
    timeDomain,
  };
}
