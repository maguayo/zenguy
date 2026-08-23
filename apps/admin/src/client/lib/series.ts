import type {
  Analytics,
  ChannelType,
  ChecksDay,
  DayPoint,
  DeliveriesDay,
  IncidentsDay,
  RunsDay,
  UsersDay,
} from "../../shared/types";

const DAY_MS = 86_400_000;

/**
 * The seven notification channels in a fixed order. Charts assign colours by this
 * order and never by rank, so filtering or a quiet channel never repaints the rest.
 */
export const CHANNELS: readonly ChannelType[] = [
  "EMAIL",
  "SMS",
  "PUSH",
  "SLACK",
  "DISCORD",
  "WHATSAPP",
  "CALL",
];

/** The keys of `T` that hold a plain number — the only ones worth summing. */
export type NumericKey<T> = {
  [K in keyof T]: T[K] extends number ? K : never;
}[keyof T];

function parseUtcDay(day: string): number | null {
  const parsed = Date.parse(`${day}T00:00:00.000Z`);
  return Number.isNaN(parsed) ? null : parsed;
}

function toUtcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The `days` UTC day keys ending at `to`, oldest first. */
export function utcDays(to: string, days: number): string[] {
  const end = parseUtcDay(to);
  if (end === null || days <= 0) return [];
  return Array.from({ length: days }, (_, index) => toUtcDay(end - (days - 1 - index) * DAY_MS));
}

/**
 * The range as a dense series: the server already zero-fills, so this is what keeps
 * a short or ragged answer from silently shrinking an axis and making a quiet week
 * look like a busy one.
 */
export function fillDays<T extends DayPoint>(
  series: readonly T[],
  range: { days: number; to: string },
  blank: (day: string) => T,
): T[] {
  const byDay = new Map(series.map((point) => [point.day, point]));
  return utcDays(range.to, range.days).map((day) => byDay.get(day) ?? blank(day));
}

const blankUsers = (day: string): UsersDay => ({ cumulative: 0, dau: 0, day, signups: 0, wau: null });

const blankRuns = (day: string): RunsDay => ({
  avgDurationMs: null,
  day,
  failed: 0,
  fallback: 0,
  inputTokens: 0,
  outputTokens: 0,
  passed: 0,
  systemError: 0,
  timeout: 0,
  total: 0,
});

const blankChecks = (day: string): ChecksDay => ({ avgResponseMs: null, day, down: 0, up: 0 });

const blankIncidents = (day: string): IncidentsDay => ({ day, opened: 0, resolved: 0 });

const blankDeliveries = (day: string): DeliveriesDay => ({
  byChannel: Object.fromEntries(CHANNELS.map((channel) => [channel, 0])) as Record<
    ChannelType,
    number
  >,
  costCents: 0,
  day,
});

export interface FilledSeries {
  checks: ChecksDay[];
  deliveries: DeliveriesDay[];
  incidents: IncidentsDay[];
  runs: RunsDay[];
  users: UsersDay[];
}

/**
 * Every series of a payload padded to the range it claims to cover. The server
 * already zero-fills, so this is insurance: a short or ragged answer would
 * otherwise shrink an axis silently and make a quiet week look like a busy one.
 * The account base is carried across a padded day rather than dropped to zero,
 * which would draw every account disappearing overnight.
 */
export function fillAnalytics(data: Analytics): FilledSeries {
  const { range } = data;
  const answered = new Set(data.users.map((point) => point.day));
  let base = 0;
  const users = fillDays(data.users, range, blankUsers).map((point) => {
    if (answered.has(point.day)) base = point.cumulative;
    return answered.has(point.day) ? point : { ...point, cumulative: base };
  });
  return {
    checks: fillDays(data.checks, range, blankChecks),
    deliveries: fillDays(data.deliveries, range, blankDeliveries),
    incidents: fillDays(data.incidents, range, blankIncidents),
    runs: fillDays(data.runs, range, blankRuns),
    users,
  };
}

export function sumSeries<T>(series: readonly T[], key: NumericKey<T>): number {
  return series.reduce((total, point) => total + Number(point[key]), 0);
}

/** The most recent point, or undefined when the range has no days at all. */
export function lastOf<T>(series: readonly T[]): T | undefined {
  return series.length === 0 ? undefined : series[series.length - 1];
}

/** The four verdicts a run can end on. `total` also counts QUEUED and RUNNING. */
export interface RunVerdicts {
  failed: number;
  passed: number;
  systemError: number;
  timeout: number;
}

/**
 * Runs that reached a verdict. `RunsDay.total` counts everything created that
 * day, QUEUED and RUNNING included, so it is a count of work started and never
 * the denominator of a rate — the server's leaderboards divide by this.
 */
export function finishedRuns(day: RunVerdicts): number {
  return day.passed + day.failed + day.timeout + day.systemError;
}

/** PASSED over every *finished* run of the day, 0..1; null when none finished. */
export function passRate(day: RunVerdicts): number | null {
  const finished = finishedRuns(day);
  if (finished <= 0) return null;
  return day.passed / finished;
}

/** The share of the day's checks that came back up, 0..100; null when none ran. */
export function uptimePct(day: { down: number; up: number }): number | null {
  const total = day.up + day.down;
  if (total <= 0) return null;
  return Math.round((day.up / total) * 10_000) / 100;
}

/** Whether every day of the range is zero on every key a chart would plot. */
export function isEmpty<T>(series: readonly T[], keys: readonly NumericKey<T>[]): boolean {
  return series.every((point) => keys.every((key) => Number(point[key]) === 0));
}

export interface PeriodDelta {
  /** The window just closed. */
  current: number;
  /** The window before it — partial, and flagged as such, on a short series. */
  previous: number;
  change: number;
  /** change / previous; null when there is no previous volume to divide by. */
  ratio: number | null;
  comparable: boolean;
}

/** The last `days` of a series against the `days` before them. */
export function periodDelta<T>(
  series: readonly T[],
  key: NumericKey<T>,
  days: number,
): PeriodDelta {
  const split = Math.max(0, series.length - days);
  const current = sumSeries(series.slice(split), key);
  const previous = sumSeries(series.slice(Math.max(0, split - days), split), key);
  return {
    change: current - previous,
    comparable: series.length >= days * 2,
    current,
    previous,
    ratio: previous === 0 ? null : (current - previous) / previous,
  };
}

export interface SparkPoint {
  day: string;
  value: number;
}

/**
 * The band a sparkline is drawn in. A fortnight that never moved has no shape
 * to show, and a flat line halfway up the card reads as activity — so a flat
 * series gets a band that starts at its own value and the stroke sits on the
 * floor.
 */
export function sparkDomain(points: readonly SparkPoint[]): [number, number] {
  if (points.length === 0) return [0, 1];
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? [min, min + 1] : [min, max];
}

/** The tail of a series, shaped for the stat tiles' 14-day sparkline. */
export function sparkline<T extends DayPoint>(
  series: readonly T[],
  key: NumericKey<T>,
  n = 14,
): SparkPoint[] {
  return series.slice(Math.max(0, series.length - n)).map((point) => ({
    day: point.day,
    value: Number(point[key]),
  }));
}

function compact(value: number, divisor: number, suffix: string): string {
  const scaled = value / divisor;
  const rounded = scaled >= 100 ? Math.round(scaled) : Math.round(scaled * 10) / 10;
  return `${rounded}${suffix}`;
}

/** LLM token counts at a glance: "912", "12.4k", "1.2M". */
export function formatTokens(value: number): string {
  const tokens = Math.max(0, Math.round(value));
  if (tokens < 1_000) return String(tokens);
  if (tokens < 999_500) return compact(tokens, 1_000, "k");
  return compact(tokens, 1_000_000, "M");
}

/**
 * Money from a cent count. Whole amounts lose their ".00" — MRR and credit
 * top-ups are always round, and "€1,170" reads faster than "€1,170.00" — while
 * per-message costs keep their cents.
 */
export function formatEuros(cents: number): string {
  const rounded = Math.round(cents);
  const fraction = rounded % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat("en-GB", {
    currency: "EUR",
    maximumFractionDigits: fraction,
    minimumFractionDigits: fraction,
    style: "currency",
  }).format(rounded / 100);
}

/** "€39 × 30" — the arithmetic behind MRR, so the estimate is never a mystery. */
export function mrrBreakdown(mrrCents: number, payingWorkspaces: number): string | null {
  if (payingWorkspaces <= 0 || mrrCents <= 0) return null;
  return `${formatEuros(mrrCents / payingWorkspaces)} × ${payingWorkspaces}`;
}

function dayFormatter(options: Intl.DateTimeFormatOptions): (day: string) => string {
  const format = new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" });
  return (day: string) => {
    const parsed = parseUtcDay(day);
    return parsed === null ? day : format.format(parsed);
  };
}

/** Axis ticks: "23 Aug". */
export const formatDayTick = dayFormatter({ day: "numeric", month: "short" });

/** Tooltip and list headings: "23 Aug 2026". */
export const formatDayLabel = dayFormatter({ day: "numeric", month: "short", year: "numeric" });

export interface RunPoint extends RunsDay {
  /** 0..100 over the finished runs; null when none finished, so the line breaks. */
  passRatePct: number | null;
  /** Share of the day's runs picked up by the VPS fallback, 0..100. */
  fallbackPct: number | null;
  /** Created but not finished: the top segment that makes the column honest. */
  inProgress: number;
  tokens: number;
  avgDurationSec: number | null;
}

function pct(part: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((part / total) * 1_000) / 10;
}

/**
 * Daily run counts plus the percentages and totals the two run charts plot.
 * The pass rate divides by the finished runs; the fallback share divides by
 * every run of the day, because that is what it is a share of.
 */
export function runSeries(runs: readonly RunsDay[]): RunPoint[] {
  return runs.map((day) => {
    const finished = finishedRuns(day);
    return {
      ...day,
      avgDurationSec: day.avgDurationMs === null ? null : Math.round(day.avgDurationMs / 100) / 10,
      fallbackPct: pct(day.fallback, day.total),
      inProgress: Math.max(0, day.total - finished),
      passRatePct: pct(day.passed, finished),
      tokens: day.inputTokens + day.outputTokens,
    };
  });
}

/** Whether any run in the range was picked up by the VPS fallback. */
export function hasFallback(runs: readonly RunsDay[]): boolean {
  return runs.some((day) => day.fallback > 0);
}

export type DeliveryPoint = DayPoint &
  Record<ChannelType, number> & { costCents: number; costEuros: number };

/** The channel map flattened onto the day, so a stacked bar can key straight into it. */
export function deliverySeries(deliveries: readonly DeliveriesDay[]): DeliveryPoint[] {
  return deliveries.map((day) => {
    const point = {
      costCents: day.costCents,
      costEuros: Math.round(day.costCents) / 100,
      day: day.day,
    } as DeliveryPoint;
    for (const channel of CHANNELS) point[channel] = day.byChannel?.[channel] ?? 0;
    return point;
  });
}

export interface ChannelTotal {
  channel: ChannelType;
  total: number;
}

/** The channels that actually delivered in the range, busiest first. */
export function channelTotals(deliveries: readonly DeliveriesDay[]): ChannelTotal[] {
  return CHANNELS.map((channel) => ({
    channel,
    total: deliveries.reduce((sum, day) => sum + (day.byChannel?.[channel] ?? 0), 0),
  }))
    .filter((entry) => entry.total > 0)
    .sort((a, b) => b.total - a.total);
}

/** A 0..100 percentage as a whole number: "83%", "—" when there is nothing to rate. */
export function formatPct(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)}%`;
}
