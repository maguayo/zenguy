import type { MonitorStats } from "@/api/types";

export type SeriesPoint = MonitorStats["series"][number];

export interface ChartBar {
  /** At least one failed check in this bucket (drawn in the danger colour). */
  failed: boolean;
  /** 0–100, relative to `max`. */
  heightPct: number;
  key: string;
  responseTimeMs: number | null;
  t: string;
}

export interface ChartModel {
  bars: ChartBar[];
  /** Y-axis ceiling in ms (a "nice" number: 1, 2 or 5 × 10ⁿ). */
  max: number;
}

export const defaultMaxBars = 48;

export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

/**
 * Folds a 24 h series (up to 288 points at 5 min) into at most `maxBars`
 * consecutive buckets so every bar stays wide enough to read and tap.
 */
export function responseTimeBars(series: SeriesPoint[], maxBars = defaultMaxBars): ChartModel {
  if (series.length === 0 || maxBars < 1) return { bars: [], max: 0 };
  const size = Math.ceil(series.length / Math.min(maxBars, series.length));
  const buckets: Omit<ChartBar, "heightPct">[] = [];
  for (let start = 0; start < series.length; start += size) {
    const points = series.slice(start, start + size);
    const first = points[0];
    if (!first) break;
    const times = points.flatMap((point) => (point.responseTimeMs === null ? [] : [point.responseTimeMs]));
    buckets.push({
      failed: points.some((point) => point.status === "FAILED"),
      key: `${first.t}-${start}`,
      responseTimeMs:
        times.length === 0 ? null : Math.round(times.reduce((sum, ms) => sum + ms, 0) / times.length),
      t: first.t,
    });
  }
  const max = niceMax(Math.max(0, ...buckets.map((bucket) => bucket.responseTimeMs ?? 0)));
  return {
    bars: buckets.map((bucket) => ({
      ...bucket,
      heightPct:
        bucket.responseTimeMs === null
          ? 0
          : Math.min(100, Math.round((bucket.responseTimeMs / max) * 1000) / 10),
    })),
    max,
  };
}
