/**
 * Every final-schema column that can directly identify one account.
 *
 * The D1 integration test derives the same set from sqlite_master, so a
 * migration that adds a user reference or account email cannot silently avoid
 * an erasure-policy decision. Owned workspace references are completed by the
 * durable workspace-deletion saga; all other entries are purged, revoked or
 * anonymized by D1AccountDeletionRepo.
 */
export const ACCOUNT_DELETION_DIRECT_REFERENCES = [
  "activity_events.user_id",
  "admin_sessions.email",
  "admin_sessions.user_id",
  "audit_logs.actor_user_id",
  "browser_tests.created_by",
  "browser_tests.updated_by",
  "email_tokens.user_id",
  "incident_updates.created_by",
  "notification_channels.created_by",
  "oauth_identities.email_at_link",
  "oauth_identities.user_id",
  "paddle_checkout_intents.actor_user_id",
  "refresh_tokens.user_id",
  "status_pages.created_by",
  "stripe_checkout_intents.actor_user_id",
  "subscription_grants.issued_by_user_id",
  "test_runs.triggered_by_user_id",
  "uptime_monitors.created_by",
  "user_legal_acceptances.user_id",
  "user_push_devices.user_id",
  "users.email",
  "users.id",
  "workspace_api_keys.created_by",
  "workspace_invitations.email",
  "workspace_invitations.invited_by",
  "workspace_members.invited_by",
  "workspace_members.user_id",
  "workspace_remote_ai_consents.accepted_by_user_id",
  "workspace_remote_ai_consents.revoked_by_user_id",
  "workspace_secrets.created_by",
  "workspaces.owner_user_id",
] as const;

/** JSON/polymorphic fields whose account references require explicit cleanup. */
export const ACCOUNT_DELETION_INDIRECT_REFERENCES = [
  "activity_events.properties_json/resource_id",
  "audit_logs.metadata_json/resource_id",
  "rate_limit_windows.rate_key",
  "run_quota_counters.scope_kind/scope_id",
  "test_runs.snapshot_json.irreversibleAuthorization",
] as const;

export interface AccountDeletionRepo {
  /** Atomically revokes credentials, removes personal data, and tombstones the user. */
  finalize(input: {
    userId: string;
    email: string;
    at: number;
  }): Promise<void>;
}
