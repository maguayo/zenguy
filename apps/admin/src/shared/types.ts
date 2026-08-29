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
