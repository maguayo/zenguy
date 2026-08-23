import { HOUR_MS } from "./constants";
import type { Windows } from "../shared/types";

export interface ScheduledItem {
  nextAt: number;
  intervalMs: number;
}

/**
 * How many executions of a periodic item fall inside `[now, windowEndMs]`.
 * An overdue item (`nextAt < now`) counts as running right now and then keeps
 * its cadence from there.
 */
export function countOccurrences(
  nextAt: number,
  intervalMs: number,
  now: number,
  windowEndMs: number,
): number {
  if (!Number.isFinite(nextAt) || !(intervalMs > 0) || !Number.isFinite(intervalMs)) return 0;
  if (!Number.isFinite(now) || !Number.isFinite(windowEndMs) || windowEndMs < now) return 0;
  const first = Math.max(nextAt, now);
  if (first > windowEndMs) return 0;
  return Math.floor((windowEndMs - first) / intervalMs) + 1;
}

export function upcomingWindows(items: ScheduledItem[], now: number): Windows<number> {
  const sum = (hours: number): number =>
    items.reduce(
      (total, item) =>
        total + countOccurrences(item.nextAt, item.intervalMs, now, now + hours * HOUR_MS),
      0,
    );
  return { h1: sum(1), h3: sum(3), h24: sum(24) };
}
