export type WorkspaceDeletionStage =
  | "DELETION_PENDING"
  | "CANCELLATION_PENDING"
  | "PURGE_PENDING";

export interface WorkspaceDeletionClaim {
  workspaceId: string;
  stage: WorkspaceDeletionStage;
  attemptCount: number;
}

/**
 * Data classification for permanent workspace deletion.
 *
 * PURGE contains customer content, credentials, runtime state and mutable
 * balances that have no post-termination legal purpose. RETAIN_ANONYMIZED is
 * the minimum accounting/security evidence retained after identifiers and
 * free-form personal data are scrubbed. `workspaces` itself is reduced to a
 * pseudonymous tombstone so retained rows keep a stable reconciliation key.
 *
 * The table lists are executable policy: the integration test compares every
 * schema table with a direct workspace_id column against this taxonomy, so a
 * new workspace-scoped table cannot silently escape deletion review.
 */
export const WORKSPACE_DELETION_TAXONOMY = {
  purge: [
    "activity_events",
    "alert_credit_balances",
    "browser_tests",
    "incident_updates",
    "incidents",
    "notification_channels",
    "notification_deliveries",
    "paddle_checkout_intents",
    "stripe_checkout_intents",
    "pending_overage_periods",
    "run_artifacts",
    "status_page_items",
    "status_pages",
    "test_runs",
    "uptime_checks",
    "uptime_monitors",
    "workspace_alert_settings",
    "workspace_api_keys",
    "workspace_data_encryption_keys",
    "workspace_invitations",
    "workspace_members",
    "workspace_secrets",
  ],
  retainAnonymized: [
    "alert_credit_entries",
    "audit_logs",
    "overage_reports",
    "subscriptions",
    "usage_events",
    "workspaces",
  ],
  purgeIndirect: [
    "browser_test_channels",
    "check_execution_claims",
    "durable_jobs",
    "incident_events",
    "queue_outbox",
    "rate_limit_windows",
    "run_steps",
    "test_attempts",
    "uptime_monitor_channels",
  ],
  anonymizeIndirect: ["subscription_grants"],
  externalPurge: ["R2 objects referenced by run_artifacts.storage_key"],
  externalCancellation: ["billing-provider subscription"],
} as const;

export interface WorkspaceDeletionRepo {
  /** Atomically commits the tombstone and quiesces every producer/consumer. */
  requestTombstone(workspaceId: string, requestedAt: number): Promise<boolean>;

  /** Claims one due saga using a recoverable lease. */
  claimDue(input: {
    now: number;
    staleBefore: number;
    workspaceId?: string;
  }): Promise<WorkspaceDeletionClaim | null>;

  markCancellationSucceeded(workspaceId: string, at: number): Promise<void>;

  recordFailure(input: {
    workspaceId: string;
    stage: WorkspaceDeletionStage;
    failedAt: number;
    retryAt: number;
    error: string;
  }): Promise<void>;

  listArtifactStorageKeys(workspaceId: string): Promise<string[]>;

  /** Purges customer data, anonymizes retained evidence and completes saga. */
  purgeAndAnonymize(workspaceId: string, at: number): Promise<void>;

  isOperational(workspaceId: string): Promise<boolean>;
}
