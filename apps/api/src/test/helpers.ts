import { env } from "cloudflare:test";
import type { Bindings } from "../shared/config";
import { loadConfig } from "../shared/config";
import {
  MAX_ACTIVE_RUNS_GLOBAL,
  MAX_ACTIVE_RUNS_PER_USER,
  MAX_DAILY_RUNS_GLOBAL,
  MAX_DAILY_RUNS_PER_OWNER,
  MAX_DAILY_RUNS_PER_USER,
  MAX_DAILY_RUNS_PER_WORKSPACE,
  MAX_MONTHLY_RUNS_GLOBAL,
  MAX_MONTHLY_RUNS_PER_OWNER,
  MAX_MONTHLY_RUNS_PER_USER,
  MAX_MONTHLY_RUNS_PER_WORKSPACE,
} from "../shared/constants";
import {
  encryptSecret,
  type EncryptionContext,
} from "../shared/crypto";
import { fakeKeyWrappingService } from "./fakes/key_wrapping";

const ENCRYPTED_WRITE_FENCE_TRIGGERS = [
  "trg_workspace_secrets_v4_insert_active_dek",
  "trg_workspace_secrets_v4_update_active_dek",
  "trg_notification_channels_v4_insert_active_dek",
  "trg_notification_channels_v4_update_active_dek",
  "trg_uptime_monitors_v4_headers_insert_active_dek",
  "trg_uptime_monitors_v4_headers_update_active_dek",
  "trg_uptime_monitors_v4_body_insert_active_dek",
  "trg_uptime_monitors_v4_body_update_active_dek",
] as const;

const DELETE_STATEMENTS = [
  "DELETE FROM run_quota_counters",
  "DELETE FROM rate_limit_windows",
  "DELETE FROM paddle_checkout_intents",
  // Test isolation only. Production purge jobs must NEVER touch billing or
  // audit retention tables: subscriptions, usage_events, overage_reports,
  // pending_overage_periods, and audit_logs.
  "DELETE FROM admin_sessions",
  "DELETE FROM durable_jobs",
  "DELETE FROM queue_outbox",
  "DELETE FROM check_execution_claims",
  "DELETE FROM uptime_checks",
  "DELETE FROM uptime_monitor_channels",
  "DELETE FROM uptime_monitors",
  "DELETE FROM incident_events",
  "DELETE FROM incidents",
  "DELETE FROM run_steps",
  "DELETE FROM run_artifacts",
  "DELETE FROM test_attempts",
  "DELETE FROM test_runs",
  "DELETE FROM browser_test_channels",
  "DELETE FROM browser_tests",
  "DELETE FROM user_push_devices",
  "DELETE FROM alert_credit_entries",
  "DELETE FROM alert_credit_balances",
  "DELETE FROM workspace_alert_settings",
  "DELETE FROM notification_deliveries",
  "DELETE FROM notification_channels",
  "DELETE FROM workspace_secrets",
  "DELETE FROM workspace_api_keys",
  "DELETE FROM workspace_data_encryption_keys",
  "DELETE FROM subscription_grants",
  "DELETE FROM pending_overage_periods",
  "DELETE FROM overage_reports",
  "DELETE FROM usage_events",
  "DELETE FROM subscriptions",
  "DELETE FROM audit_logs",
  "DELETE FROM activity_events",
  "DELETE FROM workspace_invitations",
  "DELETE FROM workspace_members",
  "DELETE FROM workspaces",
  "DELETE FROM admin_sessions",
  "DELETE FROM refresh_tokens",
  "DELETE FROM email_tokens",
  "DELETE FROM user_legal_acceptances",
  "DELETE FROM users",
] as const;

export function testEnv(): Bindings {
  return {
    ...env,
    ENVIRONMENT: "development",
    APP_URL: "http://localhost:5173",
    JWT_SECRET: "test-secret".padEnd(32, "-"),
    ENCRYPTION_KEY: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
    ENCRYPTION_KEY_ID: "test-key-current",
    KEY_WRAPPING: fakeKeyWrappingService(),
    KEY_WRAPPING_KEY_ID: "test-wrapping-current",
    ARTIFACT_URL_SECRET: "artifact-test-secret".padEnd(32, "-"),
    RUNNER_API_TOKEN: "runner-test-secret".padEnd(32, "-"),
    RUNNER_FALLBACK_API_TOKEN: "fallback-runner-test-secret".padEnd(32, "-"),
    RUNNER_CAPABILITY_SECRET: "runner-capability-test-secret".padEnd(32, "-"),
    EMAIL_FROM: "Zenguy <notifications@zenguy.com>",
    LLM_MODEL: "gpt-5-mini",
    TWILIO_ACCOUNT_SID: "test-twilio-sid",
    TWILIO_AUTH_TOKEN: "test-twilio-token",
    TWILIO_FROM_SMS: "+34600000001",
    TWILIO_FROM_WHATSAPP: "+34600000002",
    TWILIO_FROM_CALL: "+34600000003",
    PADDLE_API_KEY: "test-paddle-key",
    PADDLE_WEBHOOK_SECRET: "test-paddle-webhook-secret",
    PADDLE_CLIENT_TOKEN: "test-paddle-client-token",
    PADDLE_ENVIRONMENT: "sandbox",
    PADDLE_PRODUCT_ID: "pro_test_zenguy",
    PADDLE_PRICE_ID: "pri_test_monthly",
    PADDLE_OVERAGE_PRICE_ID: "pri_test_overage",
    PADDLE_ALERT_CREDIT_PRODUCT_ID: "pro_test_alert_credit",
    PADDLE_ALERT_CREDIT_PRICE_ID: "pri_test_alert_credit",
  };
}

export async function encryptTestValue(
  context: EncryptionContext,
  plaintext = "synthetic-integration-test-value",
): Promise<string> {
  return encryptSecret(plaintext, loadConfig(testEnv()).encryptionKeys, context);
}

/**
 * Inserts a fixture that represents data written before migration 0040.
 * Production-style test setup must not use this escape hatch.
 */
export async function insertPreFenceLegacyFixture(
  insert: () => Promise<void>,
): Promise<void> {
  await testEnv().DB.batch(
    ENCRYPTED_WRITE_FENCE_TRIGGERS.map((name) =>
      testEnv().DB.prepare(`DROP TRIGGER ${name}`),
    ),
  );
  try {
    await insert();
  } finally {
    const migration = env.TEST_MIGRATIONS.find((candidate) =>
      candidate.name.startsWith("0040_"),
    );
    if (migration === undefined) {
      throw new Error("Encrypted write fence migration is missing from tests");
    }
    await testEnv().DB.batch(
      migration.queries.map((query) => testEnv().DB.prepare(query)),
    );
  }
}

export async function freshDb(): Promise<void> {
  await testEnv().DB.batch(
    DELETE_STATEMENTS.map((statement) => testEnv().DB.prepare(statement)),
  );
  await testEnv()
    .DB.prepare(
      `UPDATE run_cost_limits
       SET max_active_runs_per_user = ?,
           max_active_runs_global = ?,
           max_daily_runs_per_workspace = ?,
           max_daily_runs_per_user = ?,
           max_daily_runs_per_owner = ?,
           max_daily_runs_global = ?,
           max_monthly_runs_per_workspace = ?,
           max_monthly_runs_per_user = ?,
           max_monthly_runs_per_owner = ?,
           max_monthly_runs_global = ?
       WHERE id = 1`,
    )
    .bind(
      MAX_ACTIVE_RUNS_PER_USER,
      MAX_ACTIVE_RUNS_GLOBAL,
      MAX_DAILY_RUNS_PER_WORKSPACE,
      MAX_DAILY_RUNS_PER_USER,
      MAX_DAILY_RUNS_PER_OWNER,
      MAX_DAILY_RUNS_GLOBAL,
      MAX_MONTHLY_RUNS_PER_WORKSPACE,
      MAX_MONTHLY_RUNS_PER_USER,
      MAX_MONTHLY_RUNS_PER_OWNER,
      MAX_MONTHLY_RUNS_GLOBAL,
    )
    .run();
}

export async function freshKv(): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await testEnv().KV.list({ cursor });
    await Promise.all(page.keys.map(({ name }) => testEnv().KV.delete(name)));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor !== undefined);
}
