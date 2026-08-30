// Response contracts shared between the admin Worker and its SPA client.
// Keep this file free of Worker-only types.

/** A section whose schema has not reached production yet. */
export type Unavailable = { unavailable: "MIGRATION_PENDING" };

export interface Windows<T> {
  h1: T;
  h3: T;
  h24: T;
}

export interface PastRunsWindow {
  total: number;
  byStatus: Record<string, number>;
  /** PASSED over finished runs; null when nothing finished in the window. */
  passRate: number | null;
  avgDurationMs: number | null;
}

export interface PastChecksWindow {
  total: number;
  up: number;
  down: number;
  avgResponseMs: number | null;
}

export interface Overview {
  users: { total: number; verified: number; newLast7d: number };
  workspaces: { total: number };
  browserTests: { active: number };
  uptimeMonitors: { total: number; up: number; down: number; unknown: number };
  browserRuns: { past: Windows<PastRunsWindow>; upcoming: Windows<number> };
  uptimeChecks: { past: Windows<PastChecksWindow>; upcoming: Windows<number> };
}

export interface WorkerCurrentAttempt {
  attemptId: string;
  runId: string;
  testName: string | null;
  workspaceName: string | null;
  startedAt: number | null;
}

export interface WorkerSummary {
  id: string;
  mode: "local" | "fallback" | "cf";
  version: string;
  startedAt: number;
  firstSeenAt: number;
  lastSeenAt: number;
  online: boolean;
  currentAttempt: WorkerCurrentAttempt | null;
}

export type WorkersResponse = { workers: WorkerSummary[]; now: number } | Unavailable;

export interface UserSummary {
  id: string;
  email: string;
  name: string;
  createdAt: number;
  emailVerified: boolean;
  workspaceCount: number;
  /** MAX(refresh_tokens.created_at); null when the account never signed in. */
  lastActiveAt: number | null;
}

// --- /api/metrics (hero dashboard) ---

export const METRIC_RANGES = [7, 30, 90] as const;
export type MetricRangeDays = (typeof METRIC_RANGES)[number];

export interface UsersDayPoint {
  day: string;
  signups: number;
  cumulative: number;
}

export interface ProductUsageDayPoint {
  /** Calendar day in Europe/Madrid. */
  day: string;
  activeUsers: number;
  webActiveUsers: number;
  appActiveUsers: number;
  visits: number;
  webVisits: number;
  appVisits: number;
}

export interface ProductUsageSlice {
  /** Unique accounts active since today's Europe/Madrid midnight. */
  dau: number;
  /** Unique accounts active in the current seven Europe/Madrid calendar days. */
  wau: number;
  /** Unique accounts active in the current 30 Europe/Madrid calendar days. */
  mau: number;
  /** DAU / MAU; null when MAU is zero. */
  dauMau: number | null;
  /** Unique accounts with qualifying activity in the selected dashboard range. */
  activeUsers: number;
  visits: number;
  visitsPerActiveUser: number | null;
}

export interface ProductUsage {
  timezone: "Europe/Madrid";
  overall: ProductUsageSlice;
  bySource: { web: ProductUsageSlice; app: ProductUsageSlice };
  series: ProductUsageDayPoint[];
}

export interface TestsDayPoint {
  day: string;
  passed: number;
  failed: number;
  timeout: number;
  systemError: number;
  /** Every run created that day, including QUEUED/RUNNING. */
  total: number;
  avgDurationMs: number | null;
}

export interface UptimeDayPoint {
  day: string;
  up: number;
  down: number;
  avgResponseMs: number | null;
}

export interface Metrics {
  range: { days: MetricRangeDays; from: string; to: string; now: number };
  users: {
    registered: number;
    newInRange: number;
    /** Distinct users with a sign-in or activity event in the last 7 days. */
    active7d: number;
    /** Accounts older than 14 days with no sign-in nor activity event in 14 days. */
    danger: number;
    series: UsersDayPoint[];
    /** Authenticated product use from human web/app events; unavailable before migration 0038. */
    productUsage: ProductUsage | Unavailable;
  };
  tests: {
    total: number;
    /** total ÷ distinct owners of workspaces with runs in range; null without owners. */
    perUser: number | null;
    /** FAILED + TIMEOUT + SYSTEM_ERROR created in the last 2 hours. */
    failed2h: number;
    /** Passing runs split by the attempt_index that passed (0 / 1 / ≥2). */
    retries: { first: number; second: number; thirdPlus: number };
    /** Estimated LLM spend in USD cents (tokens × MODEL_PRICES); windows are now-relative. */
    spendCents: { today: number; last7d: number; last30d: number };
    series: TestsDayPoint[];
  };
  uptime: {
    /** 0-100 over checks in range; null when the range has no checks. */
    upPercent: number | null;
    monitorsDown: number;
    monitorsTotal: number;
    openIncidents: number;
    series: UptimeDayPoint[];
  };
}

// --- /api/costs (Cloudflare platform usage collected daily) ---

export interface UsageProbeResult {
  probe: string;
  ok: boolean;
  rows: number;
  error?: string;
}

export interface UsageCollection {
  id: string;
  source: "cron" | "manual";
  status: "OK" | "PARTIAL" | "FAILED";
  fromDay: string;
  toDay: string;
  startedAt: number;
  finishedAt: number;
  probes: UsageProbeResult[];
}

export interface CostLine {
  key: string;
  label: string;
  /** Human unit of `monthToDate` / `included` (e.g. "M requests", "GB-month"). */
  unit: string;
  monthToDate: number;
  included: number;
  overage: number;
  /** USD cents per `unit` of overage. */
  unitPriceCents: number;
  costCents: number;
}

export interface CostDayPoint {
  day: string;
  /** Marginal cost that day per line (cents), after the month's included quota. */
  byLine: Record<string, number>;
  totalCents: number;
}

export interface Costs {
  month: { key: string; from: string; to: string; daysElapsed: number; daysInMonth: number };
  baseFeeCents: number;
  totalCents: number;
  /** Linear projection of `totalCents` to the end of the month. */
  projectedCents: number;
  topLine: { key: string; label: string; costCents: number } | null;
  lastCollection: UsageCollection | null;
  /** True when no analytics token is configured, so nothing can be collected. */
  collectorConfigured: boolean;
  lines: CostLine[];
  series: CostDayPoint[];
}

export interface RecentRun {
  id: string;
  createdAt: number;
  workspaceName: string | null;
  testName: string | null;
  source: string;
  status: string;
  durationMs: number | null;
  attemptCount: number;
  passedAfterRetry: boolean;
  /** "MIGRATION_PENDING" while 0023 has not reached the bound database. */
  runnerId: string | null | "MIGRATION_PENDING";
  runnerKind: string | null;
}
