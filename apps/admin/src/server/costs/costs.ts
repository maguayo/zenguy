import type { Costs, MetricRangeDays } from "../../shared/types";
import { latestCollection, loadUsage } from "../db/usage";
import { computeCosts } from "./pricing";

const DAY_MS = 86_400_000;

function utcDay(timestampMs: number): string {
  return new Date(timestampMs).toISOString().slice(0, 10);
}

/**
 * The costs payload for the dashboard. Usage is read from the first day of the
 * window's earliest month, not just the window: monthly quotas only make sense
 * against each month's full cumulative usage.
 */
export async function loadCosts(
  db: D1Database,
  now: number,
  days: MetricRangeDays,
  collectorConfigured: boolean,
): Promise<Costs> {
  const today = utcDay(now);
  const windowStart = utcDay(now - (days - 1) * DAY_MS);
  const [rows, lastCollection] = await Promise.all([
    loadUsage(db, `${windowStart.slice(0, 7)}-01`, today),
    latestCollection(db),
  ]);
  return { ...computeCosts(rows, now, days), lastCollection, collectorConfigured };
}
