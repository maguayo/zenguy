export const DAY_MS = 86_400_000;

export interface IncidentInterval {
  openedAt: number;
  resolvedAt: number | null;
}

export interface DayAvailability {
  /** UTC calendar day, "YYYY-MM-DD". */
  date: string;
  downtimeSeconds: number;
  /** false before the resource existed. */
  hasData: boolean;
}

function overlapMs(
  interval: IncidentInterval,
  fromMs: number,
  toMs: number,
  nowMs: number,
): number {
  const end = interval.resolvedAt ?? nowMs;
  const start = Math.max(interval.openedAt, fromMs);
  return Math.max(0, Math.min(end, toMs) - start);
}

/**
 * Downtime per UTC day over the trailing window, oldest day first and ending
 * on today's (partial) day. Derived from incidents, so only confirmed
 * outages count; open incidents accrue up to `nowMs`.
 */
export function dailyDowntime(
  incidents: IncidentInterval[],
  nowMs: number,
  days: number,
  resourceCreatedAt: number,
): DayAvailability[] {
  const todayStart = Math.floor(nowMs / DAY_MS) * DAY_MS;
  const result: DayAvailability[] = [];
  for (let index = days - 1; index >= 0; index -= 1) {
    const dayStart = todayStart - index * DAY_MS;
    const dayEnd = dayStart + DAY_MS;
    let downtimeMs = 0;
    for (const incident of incidents) {
      downtimeMs += overlapMs(incident, dayStart, dayEnd, nowMs);
    }
    result.push({
      date: new Date(dayStart).toISOString().slice(0, 10),
      downtimeSeconds: Math.min(86_400, Math.round(downtimeMs / 1_000)),
      hasData: dayEnd > resourceCreatedAt,
    });
  }
  return result;
}

/**
 * Availability percentage over the trailing window, using the resource's own
 * age when it is younger than the window. Two decimals; null when the
 * resource has no observable lifetime yet.
 */
export function uptimePercent(
  incidents: IncidentInterval[],
  nowMs: number,
  days: number,
  resourceCreatedAt: number,
): number | null {
  const windowStart = Math.max(nowMs - days * DAY_MS, resourceCreatedAt);
  const windowMs = nowMs - windowStart;
  if (windowMs <= 0) return null;
  let downtimeMs = 0;
  for (const incident of incidents) {
    downtimeMs += overlapMs(incident, windowStart, nowMs, nowMs);
  }
  const ratio = Math.max(0, 1 - downtimeMs / windowMs);
  return Math.round(ratio * 10_000) / 100;
}
