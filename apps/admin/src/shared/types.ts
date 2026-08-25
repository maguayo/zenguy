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
