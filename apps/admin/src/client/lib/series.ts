import type { Metrics, TestsDayPoint } from "../../shared/types";

/** "67%", or an em dash where a rate has no denominator. */
export function pct(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)}%`;
}

/** Estimated spend: whole dollars stay whole, anything else keeps its cents. */
export function formatUsd(cents: number): string {
  const rounded = Math.round(cents);
  const fraction = rounded % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: fraction,
    minimumFractionDigits: fraction,
    style: "currency",
  }).format(rounded / 100);
}

function parseUtcDay(day: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(day)) return null;
  const parsed = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dayFormatter(options: Intl.DateTimeFormatOptions): (day: string) => string {
  const format = new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" });
  return (day: string) => {
    const parsed = parseUtcDay(day);
    return parsed === null ? day : format.format(parsed);
  };
}

/** Axis ticks: "29 Aug". */
export const formatDayTick = dayFormatter({ day: "numeric", month: "short" });

/** Tooltip headings: "29 Aug 2026". */
export const formatDayLabel = dayFormatter({ day: "numeric", month: "short", year: "numeric" });

export interface TestPoint extends TestsDayPoint {
  /** Created but not finished: the top segment that keeps the column honest. */
  inProgress: number;
  /** 0..100 over the finished runs; null when none finished, so the line breaks. */
  passRatePct: number | null;
}

export function testsPoints(series: TestsDayPoint[]): TestPoint[] {
  return series.map((point) => {
    const finished = point.passed + point.failed + point.timeout + point.systemError;
    return {
      ...point,
      inProgress: Math.max(0, point.total - finished),
      passRatePct: finished > 0 ? (point.passed / finished) * 100 : null,
    };
  });
}

export function sumBy<T>(series: readonly T[], key: keyof T): number {
  return series.reduce((sum, point) => {
    const value = point[key];
    return sum + (typeof value === "number" ? value : 0);
  }, 0);
}

export function isEmptySeries<T>(series: readonly T[], keys: readonly (keyof T)[]): boolean {
  return series.every((point) => keys.every((key) => (point[key] ?? 0) === 0));
}

export interface RetryShare {
  key: string;
  label: string;
  count: number;
  sharePct: number;
}

/** Passing runs by the attempt that passed, as ordered shares of all passes. */
export function retriesShares(retries: Metrics["tests"]["retries"]): RetryShare[] {
  const total = retries.first + retries.second + retries.thirdPlus;
  const share = (count: number) => (total > 0 ? (count / total) * 100 : 0);
  return [
    { key: "first", label: "1ª", count: retries.first, sharePct: share(retries.first) },
    { key: "second", label: "2ª", count: retries.second, sharePct: share(retries.second) },
    { key: "thirdPlus", label: "3ª+", count: retries.thirdPlus, sharePct: share(retries.thirdPlus) },
  ];
}
