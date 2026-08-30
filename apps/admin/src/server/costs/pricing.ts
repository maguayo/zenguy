import type { CostDayPoint, CostLine, Costs } from "../../shared/types";
import type { UsageRow } from "../db/usage";

/**
 * One billable line of the Workers Paid plan. `metrics` are the
 * platform_usage_daily keys summed into it; storage lines bill the month's
 * average daily footprint (GB-month) instead of a running sum.
 *
 * Prices and included allowances are the docs' USD list prices as of
 * 2026-08-28 (developers.cloudflare.com/<product>/pricing). Edit here when
 * Cloudflare reprices; the panel labels every figure as an estimate.
 */
export interface LineSpec {
  key: string;
  label: string;
  /** Human unit of the priced quantity, e.g. "M requests" or "GB-month". */
  unit: string;
  /** Raw metric units per priced unit (1e6 for "M …", 1e9 bytes for GB). */
  unitSize: number;
  includedUnits: number;
  priceCentsPerUnit: number;
  metrics: readonly string[];
  storage?: boolean;
}

const M = 1_000_000;
const GB = 1_000_000_000;

/** Workers Paid subscription, per account and month. */
export const BASE_FEE_CENTS = 500;

export const LINES: readonly LineSpec[] = [
  { key: "workers.requests", label: "Workers requests", unit: "M requests", unitSize: M, includedUnits: 10, priceCentsPerUnit: 30, metrics: ["workers.requests"] },
  { key: "workers.cpu", label: "Workers CPU", unit: "M CPU-ms", unitSize: M, includedUnits: 30, priceCentsPerUnit: 2, metrics: ["workers.cpu_ms"] },
  { key: "d1.rows_read", label: "D1 rows read", unit: "M rows", unitSize: M, includedUnits: 25_000, priceCentsPerUnit: 0.1, metrics: ["d1.rows_read"] },
  { key: "d1.rows_written", label: "D1 rows written", unit: "M rows", unitSize: M, includedUnits: 50, priceCentsPerUnit: 100, metrics: ["d1.rows_written"] },
  { key: "d1.storage", label: "D1 storage", unit: "GB-month", unitSize: GB, includedUnits: 5, priceCentsPerUnit: 75, metrics: ["d1.storage_bytes"], storage: true },
  { key: "do.requests", label: "Durable Objects requests", unit: "M requests", unitSize: M, includedUnits: 1, priceCentsPerUnit: 15, metrics: ["do.requests"] },
  { key: "do.duration", label: "Durable Objects duration", unit: "M GB-s", unitSize: M, includedUnits: 0.4, priceCentsPerUnit: 1_250, metrics: ["do.duration_gbs"] },
  // Containers: allowances quoted by the docs in minutes/hours, converted to seconds.
  { key: "containers.cpu", label: "Containers vCPU", unit: "vCPU-s", unitSize: 1, includedUnits: 22_500, priceCentsPerUnit: 0.002, metrics: ["containers.vcpu_s"] },
  { key: "containers.memory", label: "Containers memory", unit: "GiB-s", unitSize: 1, includedUnits: 90_000, priceCentsPerUnit: 0.00025, metrics: ["containers.memory_gib_s"] },
  { key: "containers.disk", label: "Containers disk", unit: "GB-s", unitSize: 1, includedUnits: 720_000, priceCentsPerUnit: 0.000007, metrics: ["containers.disk_gb_s"] },
  { key: "kv.reads", label: "KV reads", unit: "M keys", unitSize: M, includedUnits: 10, priceCentsPerUnit: 50, metrics: ["kv.reads"] },
  { key: "kv.writes", label: "KV writes", unit: "M keys", unitSize: M, includedUnits: 1, priceCentsPerUnit: 500, metrics: ["kv.writes"] },
  { key: "kv.deletes", label: "KV deletes", unit: "M keys", unitSize: M, includedUnits: 1, priceCentsPerUnit: 500, metrics: ["kv.deletes"] },
  { key: "kv.lists", label: "KV lists", unit: "M requests", unitSize: M, includedUnits: 1, priceCentsPerUnit: 500, metrics: ["kv.lists"] },
  { key: "kv.storage", label: "KV storage", unit: "GB-month", unitSize: GB, includedUnits: 1, priceCentsPerUnit: 50, metrics: ["kv.storage_bytes"], storage: true },
  { key: "r2.class_a", label: "R2 Class A ops", unit: "M ops", unitSize: M, includedUnits: 1, priceCentsPerUnit: 450, metrics: ["r2.class_a"] },
  { key: "r2.class_b", label: "R2 Class B ops", unit: "M ops", unitSize: M, includedUnits: 10, priceCentsPerUnit: 36, metrics: ["r2.class_b"] },
  { key: "r2.storage", label: "R2 storage", unit: "GB-month", unitSize: GB, includedUnits: 10, priceCentsPerUnit: 1.5, metrics: ["r2.storage_bytes"], storage: true },
  { key: "queues.operations", label: "Queues operations", unit: "M ops", unitSize: M, includedUnits: 1, priceCentsPerUnit: 40, metrics: ["queues.operations"] },
  { key: "email.sent", label: "Emails sent", unit: "k emails", unitSize: 1_000, includedUnits: 3, priceCentsPerUnit: 35, metrics: ["email.sent"] },
];

const DAY_MS = 86_400_000;

function utcDay(timestampMs: number): string {
  return new Date(timestampMs).toISOString().slice(0, 10);
}

function monthKey(day: string): string {
  return day.slice(0, 7);
}

function chargedCents(units: number, line: LineSpec): number {
  return Math.max(0, units - line.includedUnits) * line.priceCentsPerUnit;
}

/** Month-to-date lines, totals, a linear projection and the daily marginal series. */
export function computeCosts(
  rows: readonly UsageRow[],
  now: number,
  rangeDays: number,
): Omit<Costs, "lastCollection" | "collectorConfigured"> {
  const today = utcDay(now);
  const current = monthKey(today);
  const year = Number(current.slice(0, 4));
  const monthIndex = Number(current.slice(5, 7)) - 1;
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const daysElapsed = Number(today.slice(8, 10));
  const month = {
    key: current,
    from: `${current}-01`,
    to: `${current}-${String(daysInMonth).padStart(2, "0")}`,
    daysElapsed,
    daysInMonth,
  };

  // metric → day → value, for every month present (the series needs each
  // month's own cumulative, not only the current one).
  const byMetric = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const days = byMetric.get(row.metric) ?? new Map<string, number>();
    days.set(row.day, (days.get(row.day) ?? 0) + row.value);
    byMetric.set(row.metric, days);
  }

  const lines: CostLine[] = LINES.map((line) => {
    const perDay = new Map<string, number>();
    for (const metric of line.metrics) {
      for (const [day, value] of byMetric.get(metric) ?? []) {
        if (monthKey(day) !== current) continue;
        perDay.set(day, (perDay.get(day) ?? 0) + value);
      }
    }
    const values = [...perDay.values()];
    const raw =
      line.storage === true
        ? values.length === 0
          ? 0
          : values.reduce((sum, value) => sum + value, 0) / values.length
        : values.reduce((sum, value) => sum + value, 0);
    const monthToDate = raw / line.unitSize;
    const overage = Math.max(0, monthToDate - line.includedUnits);
    return {
      key: line.key,
      label: line.label,
      unit: line.unit,
      monthToDate,
      included: line.includedUnits,
      overage,
      unitPriceCents: line.priceCentsPerUnit,
      costCents: Math.round(overage * line.priceCentsPerUnit),
    };
  });

  const usageCents = lines.reduce((sum, line) => sum + line.costCents, 0);
  const top = lines.reduce<CostLine | null>(
    (best, line) => (line.costCents > 0 && (best === null || line.costCents > best.costCents) ? line : best),
    null,
  );

  // Daily marginal cost: within each month, the cents charged once the
  // cumulative usage crosses the included quota, attributed to that day.
  const windowStart = utcDay(now - (rangeDays - 1) * DAY_MS);
  const windowDays = Array.from({ length: rangeDays }, (_, index) =>
    utcDay(now - (rangeDays - 1 - index) * DAY_MS),
  );
  const marginal = new Map<string, Record<string, number>>();
  for (const line of LINES) {
    if (line.storage === true) continue;
    const perDay = new Map<string, number>();
    for (const metric of line.metrics) {
      for (const [day, value] of byMetric.get(metric) ?? []) {
        perDay.set(day, (perDay.get(day) ?? 0) + value);
      }
    }
    const cumulative = new Map<string, number>();
    for (const day of [...perDay.keys()].sort()) {
      const month = monthKey(day);
      const units = (cumulative.get(month) ?? 0) + (perDay.get(day) ?? 0) / line.unitSize;
      const before = chargedCents(cumulative.get(month) ?? 0, line);
      cumulative.set(month, units);
      const cents = Math.round(chargedCents(units, line) - before);
      if (cents <= 0 || day < windowStart || day > today) continue;
      const bucket = marginal.get(day) ?? {};
      bucket[line.key] = (bucket[line.key] ?? 0) + cents;
      marginal.set(day, bucket);
    }
  }
  const series: CostDayPoint[] = windowDays.map((day) => {
    const byLine = marginal.get(day) ?? {};
    return {
      day,
      byLine,
      totalCents: Object.values(byLine).reduce((sum, cents) => sum + cents, 0),
    };
  });

  return {
    month,
    baseFeeCents: BASE_FEE_CENTS,
    totalCents: BASE_FEE_CENTS + usageCents,
    projectedCents:
      BASE_FEE_CENTS + Math.round((usageCents * daysInMonth) / Math.max(1, daysElapsed)),
    topLine: top === null ? null : { key: top.key, label: top.label, costCents: top.costCents },
    lines,
    series,
  };
}
