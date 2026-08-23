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
  mode: "local" | "fallback";
  version: string;
  startedAt: number;
  firstSeenAt: number;
  lastSeenAt: number;
  online: boolean;
  currentAttempt: WorkerCurrentAttempt | null;
  /**
   * Distinct runs this worker claimed an attempt on in the last 24 h / 7 d,
   * windowed on the run's created_at — a retried run counts once. `tokens24h`
   * is the sum over every attempt of those 24 h runs.
   */
  runs24h: number;
  runs7d: number;
  tokens24h: number;
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

export type ChannelType =
  | "EMAIL"
  | "SMS"
  | "WHATSAPP"
  | "CALL"
  | "SLACK"
  | "DISCORD"
  | "PUSH";

/** One UTC calendar day, "YYYY-MM-DD". Every series is zero filled, oldest first. */
export interface DayPoint {
  day: string;
}

export interface UsersDay extends DayPoint {
  signups: number;
  /** Accounts created up to and including this day, across all time. */
  cumulative: number;
  dau: number;
  /** Exact trailing 7 day distinct sign-ins; null outside the last 14 days. */
  wau: number | null;
}

export interface RunsDay extends DayPoint {
  passed: number;
  failed: number;
  timeout: number;
  systemError: number;
  /** Every run created that day, QUEUED and RUNNING included. */
  total: number;
  /** Runs whose last attempt ran on the fallback runner. */
  fallback: number;
  avgDurationMs: number | null;
  inputTokens: number;
  outputTokens: number;
}

export interface ChecksDay extends DayPoint {
  up: number;
  down: number;
  avgResponseMs: number | null;
}

export interface IncidentsDay extends DayPoint {
  opened: number;
  resolved: number;
}

export interface DeliveriesDay extends DayPoint {
  /** SENT deliveries only; every channel type is always present. */
  byChannel: Record<ChannelType, number>;
  /** Every delivery of the day, whatever its status. */
  costCents: number;
}

export interface AnalyticsBusiness {
  payingWorkspaces: number;
  mrrCents: number;
  freeWorkspaces: number;
  grantWorkspaces: number;
  creditTopupsCents30d: number;
  openIncidents: number;
  activeUsers7d: number;
  activeUsers30d: number;
}

export interface TestLeaderboardRow {
  testId: string;
  name: string;
  workspaceName: string | null;
  runs: number;
  /** Finished runs that did not pass: FAILED, TIMEOUT and SYSTEM_ERROR. */
  failed: number;
  passRate: number | null;
  avgDurationMs: number | null;
}

export interface ActiveWorkspaceRow {
  workspaceId: string;
  name: string;
  runs: number;
  monitors: number;
  lastRunAt: number | null;
  /** The subscription source: "paddle", "free", "grant" or "none". */
  subscription: string;
}

export interface MonitorDownRow {
  monitorId: string;
  name: string;
  workspaceName: string | null;
  /** uptime_monitors.cycle_started_at: when the failing cycle began. */
  since: number | null;
}

export interface OpenIncidentRow {
  incidentId: string;
  resourceType: "BROWSER_TEST" | "UPTIME_MONITOR";
  resourceName: string | null;
  workspaceName: string | null;
  openedAt: number;
}

export interface Analytics {
  range: { days: number; from: string; to: string; now: number };
  users: UsersDay[];
  runs: RunsDay[];
  checks: ChecksDay[];
  incidents: IncidentsDay[];
  deliveries: DeliveriesDay[];
  business: AnalyticsBusiness;
  /** 7 d, failures desc then runs desc, max 10, only tests that failed once. */
  topFailingTests: TestLeaderboardRow[];
  /** 7 d, average duration desc, max 10, only tests with 3+ runs that recorded a duration. */
  slowestTests: TestLeaderboardRow[];
  /** 30 d, runs desc, max 10, live workspaces only. */
  activeWorkspaces: ActiveWorkspaceRow[];
  monitorsDown: MonitorDownRow[];
  openIncidents: OpenIncidentRow[];
}

// --- Activity -------------------------------------------------------------
// Client-safe copies of the contracts the activity endpoints answer with.
// `ActivitySource`, `ActivityFeedEvent` and `ActivityFeedResponse` mirror
// src/server/db/activity.ts; `LastRunStatus`, `WorkspaceActivitySummary` and
// `WorkspacesResponse` mirror src/server/db/workspaces.ts. The client cannot
// import those files (Worker-only tsconfig), so the shapes are duplicated here
// and must stay structurally identical — change one, change the other.

export type ActivitySource = "web" | "app" | "api" | "server";

export interface ActivityFeedEvent {
  id: string;
  type: string;
  occurredAt: number;
  source: ActivitySource;
  /** Null for system-originated events, or when the user no longer exists. */
  actor: { id: string; name: string; email: string } | null;
  /** Null for user-scoped events, or when the workspace no longer exists. */
  workspace: { id: string; name: string } | null;
  resourceType: string | null;
  resourceId: string | null;
  properties: Record<string, unknown> | null;
}

export type ActivityFeedResponse = { events: ActivityFeedEvent[] } | Unavailable;

export type LastRunStatus = "PASSED" | "FAILED" | "TIMEOUT" | "SYSTEM_ERROR";

export interface WorkspaceActivitySummary {
  id: string;
  name: string;
  slug: string;
  ownerEmail: string | null;
  memberCount: number;
  createdAt: number;
  /** Newest event with a user behind it; system-originated rows do not count. */
  lastActiveAt: number | null;
  lastWebAt: number | null;
  lastAppAt: number | null;
  /** Newest `user.logged_in` of any current member (logins carry no workspace). */
  lastLoginAt: number | null;
  lastTestCreatedAt: number | null;
  lastRunAt: number | null;
  lastRunStatus: LastRunStatus | null;
  lastAlertSentAt: number | null;
}

export type WorkspacesResponse = { workspaces: WorkspaceActivitySummary[] } | Unavailable;
