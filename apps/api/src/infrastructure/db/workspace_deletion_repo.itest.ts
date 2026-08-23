import { WORKSPACE_DELETION_TAXONOMY } from "../../domain/workspaces/deletion";
import { freshDb, testEnv } from "../../test/helpers";
import { D1WorkspaceDeletionRepo } from "./workspace_deletion_repo";

const WORKSPACE_ID = "ws_delete_all";
const NOW = 50_000;

function statement(sql: string, ...values: unknown[]): D1PreparedStatement {
  return testEnv().DB.prepare(sql).bind(...values);
}

async function count(
  table: string,
  where = "",
  ...values: unknown[]
): Promise<number> {
  const row = await testEnv()
    .DB.prepare(`SELECT COUNT(*) AS value FROM ${table} ${where}`)
    .bind(...values)
    .first<{ value: number }>();
  return row?.value ?? 0;
}

async function seedCompleteWorkspaceGraph(): Promise<void> {
  await testEnv().DB.batch([
    statement(
      `INSERT INTO users
        (id, name, email, password_hash, created_at, updated_at)
       VALUES ('usr_delete', 'Delete Me', 'delete@example.com', 'hash', 1, 1)`,
    ),
    statement(
      `INSERT INTO workspaces
        (id, name, slug, timezone, owner_user_id, created_at, updated_at)
       VALUES (?, 'Private workspace', 'private-workspace', 'Europe/Madrid',
               'usr_delete', 1, 1)`,
      WORKSPACE_ID,
    ),
    statement(
      `INSERT INTO workspace_data_encryption_keys
        (workspace_id, data_key_id, generation, wrapping_key_id, wrap_version,
         wrapped_key, active, created_at, updated_at, retired_at)
       VALUES (?, 'dek-AAAAAAAAAAAAAAAAAAAAAAAA', 1, 'key-delete', 1,
               'w1:key-delete:AAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
               1, 1, 1, NULL)`,
      WORKSPACE_ID,
    ),
    statement(
      `INSERT INTO workspace_members
        (id, workspace_id, user_id, role, joined_at)
       VALUES ('mem_delete', ?, 'usr_delete', 'OWNER', 1)`,
      WORKSPACE_ID,
    ),
    statement(
      `INSERT INTO workspace_invitations
        (id, workspace_id, email, role, token_hash, invited_by,
         expires_at, created_at)
       VALUES ('inv_delete', ?, 'invite@example.com', 'MEMBER', 'invite-hash',
               'usr_delete', 999999, 1)`,
      WORKSPACE_ID,
    ),
    statement(
      `INSERT INTO audit_logs
        (id, workspace_id, actor_user_id, action, resource_type,
         resource_id, metadata_json, ip, created_at)
       VALUES ('aud_delete', ?, 'usr_delete', 'workspace.deleted', 'workspace',
               ?, '{"name":"Private workspace"}', '203.0.113.5', 1)`,
      WORKSPACE_ID,
      WORKSPACE_ID,
    ),
    statement(
      `INSERT INTO activity_events
        (id, type, user_id, workspace_id, source, resource_type, resource_id,
         properties_json, occurred_at)
       VALUES ('act_delete', 'browser_test.viewed', 'usr_delete', ?, 'web',
               'browser_test', 'bt_delete', '{"private":true}', 2)`,
      WORKSPACE_ID,
    ),
    // Control row: another workspace's activity must survive the purge.
    statement(
      `INSERT INTO activity_events
        (id, type, user_id, workspace_id, source, resource_type, resource_id,
         properties_json, occurred_at)
       VALUES ('act_keep', 'web.page_viewed', 'usr_other', 'ws_other', 'web',
               NULL, NULL, NULL, 2)`,
    ),
    statement(
      `INSERT INTO subscriptions
        (id, workspace_id, provider, provider_customer_id,
         provider_subscription_id, status, update_payment_url, cancel_url,
         created_at, updated_at)
       VALUES ('sub_delete', ?, 'paddle', 'ctm_private', 'sub_keep_for_legal',
               'ACTIVE', 'https://buyer.test/update?token=secret',
               'https://buyer.test/cancel?token=secret', 1, 1)`,
      WORKSPACE_ID,
    ),
    statement(
      `INSERT INTO workspace_secrets
        (id, workspace_id, key, encrypted_value, encryption_version, allowed_domains,
         description, created_by, created_at, updated_at)
       VALUES ('sec_delete', ?, 'PASSWORD',
               'v4:dek-AAAAAAAAAAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
               4, '["example.com"]',
               'private note', 'usr_delete', 1, 1)`,
      WORKSPACE_ID,
    ),
    statement(
      `INSERT INTO notification_channels
        (id, workspace_id, name, type, encrypted_config, enabled,
         created_by, created_at, updated_at)
       VALUES ('ch_delete', ?, 'Private Slack', 'SLACK',
               'v4:dek-AAAAAAAAAAAAAAAAAAAAAAAA:CCCCCCCCCCCCCCCC:DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
               1,
               'usr_delete', 1, 1)`,
      WORKSPACE_ID,
    ),
    statement(
      `INSERT INTO browser_tests
        (id, workspace_id, name, start_url, instructions, device,
         interval_hours, max_retries, next_run_at, created_by, created_at,
         updated_at)
       VALUES ('bt_delete', ?, 'Private test', 'https://example.com',
               'Use the customer password', 'DESKTOP', 1, 1, 60_000,
               'usr_delete', 1, 1)`,
      WORKSPACE_ID,
    ),
    statement(
      `INSERT INTO test_runs
        (id, workspace_id, browser_test_id, source, status, snapshot_json,
         queued_at, billable, created_at)
       VALUES ('run_delete', ?, 'bt_delete', 'MANUAL', 'RUNNING',
               '{"instructions":"private"}', 1, 1, 1)`,
      WORKSPACE_ID,
    ),
    statement(
      `INSERT INTO test_attempts
        (id, test_run_id, attempt_index, status, queued_at, started_at,
         created_at)
       VALUES ('att_delete', 'run_delete', 0, 'RUNNING', 1, 2, 1)`,
    ),
    statement(
      `INSERT INTO run_steps
        (id, attempt_id, sequence, timestamp, action_type, description,
         url_sanitized, result, created_at)
       VALUES ('step_delete', 'att_delete', 0, 2, 'navigate', 'private step',
               'https://example.com/private', 'OK', 2)`,
    ),
    statement(
      `INSERT INTO run_artifacts
        (id, workspace_id, run_id, attempt_id, type, storage_key, mime_type,
         size_bytes, metadata_json, created_at, expires_at)
       VALUES ('art_delete', ?, 'run_delete', 'att_delete', 'SCREENSHOT',
               'ws/ws_delete_all/run/run_delete/private.jpg', 'image/jpeg',
               100, '{"private":true}', 2, 999999)`,
      WORKSPACE_ID,
    ),
    statement(
      `INSERT INTO usage_events
        (id, workspace_id, test_run_id, quantity, billable, idempotency_key,
         occurred_at, created_at)
       VALUES ('use_delete', ?, 'run_delete', 1, 1, 'usage-private', 2, 2)`,
      WORKSPACE_ID,
    ),
    statement(
      `INSERT INTO overage_reports
        (id, workspace_id, period_start, period_end, overage_runs,
         amount_cents, paddle_transaction_id, reported_at)
       VALUES ('ovr_delete', ?, 0, 10, 1, 20, 'txn_keep_for_legal', 10)`,
      WORKSPACE_ID,
    ),
    statement(
      `INSERT INTO uptime_monitors
        (id, workspace_id, name, url, method, frequency_seconds, max_retries,
         next_check_at, current_cycle_id, cycle_started_at, created_by,
         created_at, updated_at)
       VALUES ('mon_delete', ?, 'Private health', 'https://example.com/health',
               'GET', 300, 1, 60_000, 'cycle_delete', 2, 'usr_delete', 1, 1)`,
      WORKSPACE_ID,
    ),
    statement(
      `INSERT INTO uptime_checks
        (id, workspace_id, uptime_monitor_id, cycle_id, attempt_index,
         status, failure_reason, response_excerpt, checked_at, created_at)
       VALUES ('check_delete', ?, 'mon_delete', 'cycle_delete', 0, 'FAILED',
               'private failure', 'private response', 2, 2)`,
      WORKSPACE_ID,
    ),
    statement(
      `INSERT INTO incidents
        (id, workspace_id, resource_type, browser_test_id, status, opened_at,
         opened_by_run_id, last_event_at, created_at)
       VALUES ('inc_delete', ?, 'BROWSER_TEST', 'bt_delete', 'OPEN', 2,
               'run_delete', 2, 2)`,
      WORKSPACE_ID,
    ),
    statement(
      `INSERT INTO incident_events
        (id, incident_id, type, source_id, message, metadata_json, created_at)
       VALUES ('evt_delete', 'inc_delete', 'OPENED', 'run_delete',
               'private incident', '{"private":true}', 2)`,
    ),
    statement(
      `INSERT INTO notification_deliveries
        (id, workspace_id, incident_id, notification_channel_id, event_type,
         status, dedupe_key, created_at)
       VALUES ('del_delete', ?, 'inc_delete', 'ch_delete', 'FAILURE',
               'PENDING', 'delivery-private', 2)`,
      WORKSPACE_ID,
    ),
    statement(
      `INSERT INTO browser_test_channels
        (browser_test_id, notification_channel_id)
       VALUES ('bt_delete', 'ch_delete')`,
    ),
    statement(
      `INSERT INTO uptime_monitor_channels
        (uptime_monitor_id, notification_channel_id)
       VALUES ('mon_delete', 'ch_delete')`,
    ),
    statement(
      `INSERT INTO pending_overage_periods
        (workspace_id, period_start, period_end, created_at, next_attempt_at)
       VALUES (?, 0, 10, 2, 60_000)`,
      WORKSPACE_ID,
    ),
    statement(
      `INSERT INTO workspace_api_keys
        (id, workspace_id, name, key_prefix, key_hash, scopes_json, expires_at,
         created_by, created_at)
       VALUES ('key_delete', ?, 'Private key', 'zg_live_', 'key-hash',
               '["workspace:read"]', 86400002, 'usr_delete', 2)`,
      WORKSPACE_ID,
    ),
    statement(
      `INSERT INTO workspace_alert_settings
        (workspace_id, paid_channels_enabled, daily_paid_alert_limit,
         created_at, updated_at)
       VALUES (?, 1, 20, 2, 2)`,
      WORKSPACE_ID,
    ),
    statement(
      `INSERT INTO alert_credit_balances
        (workspace_id, balance_cents, updated_at)
       VALUES (?, 500, 2)`,
      WORKSPACE_ID,
    ),
    statement(
      `INSERT INTO alert_credit_entries
        (id, workspace_id, kind, amount_cents, balance_after_cents,
         delivery_id, provider_transaction_id, description, idempotency_key,
         created_at)
       VALUES ('ace_delete', ?, 'CHARGE', -20, 500, 'del_delete',
               'txn_credit_keep', 'Private phone destination',
               'charge:del_delete', 2)`,
      WORKSPACE_ID,
    ),
    statement(
      `INSERT INTO paddle_checkout_intents
        (id, workspace_id, actor_user_id, purpose, product_id, price_id, quantity,
         currency_code, amount_cents, created_at, expires_at)
       VALUES ('pci_delete', ?, 'usr_delete', 'subscription', 'pro_private', 'pri_private', 1,
               'EUR', 2000, 2, 999999)`,
      WORKSPACE_ID,
    ),
    statement(
      `INSERT INTO subscription_grants
        (id, token_hash, issued_by_user_id, note, expires_at, redeemed_at,
         redeemed_workspace_id, created_at)
       VALUES ('grant_delete', 'grant-hash', 'usr_delete', 'legal note',
               999999, 2, ?, 1)`,
      WORKSPACE_ID,
    ),
    statement(
      `INSERT INTO check_execution_claims
        (cycle_id, attempt_index, claim_token, claimed_at)
       VALUES ('cycle_delete', 0, 'claim-private', 2)`,
    ),
    statement(
      `INSERT INTO queue_outbox
        (id, dedupe_key, queue_kind, payload_json, available_at, created_at,
         updated_at)
       VALUES ('out_delete', 'out-delete', 'NOTIFY', ?, 2, 2, 2)`,
      JSON.stringify({
        kind: "notify",
        workspaceId: WORKSPACE_ID,
        deliveryId: "del_delete",
        channelId: "ch_delete",
      }),
    ),
    statement(
      `INSERT INTO durable_jobs
        (id, kind, aggregate_key, payload_json, status, created_at, updated_at)
       VALUES ('job_delete', 'ATTEMPT_CONTINUATION', 'att_delete', ?,
               'PENDING', 2, 2)`,
      JSON.stringify({ runId: "run_delete", attemptId: "att_delete" }),
    ),
    statement(
      `INSERT INTO rate_limit_windows
        (rate_key, window_start, request_count, expires_at)
       VALUES (?, 0, 1, 999999)`,
      `run_create:workspace:${WORKSPACE_ID}`,
    ),
  ]);
}

describe("D1WorkspaceDeletionRepo", () => {
  beforeEach(async () => {
    await freshDb();
    await seedCompleteWorkspaceGraph();
  });

  it("classifies every direct workspace table in the deletion policy", async () => {
    const tables = await testEnv()
      .DB.prepare(
        `SELECT name, sql FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name`,
      )
      .all<{ name: string; sql: string | null }>();
    const directlyScoped = tables.results
      .filter(
        ({ sql }) =>
          sql !== null && /(?:\(|,)\s*workspace_id\s/iu.test(sql),
      )
      .map(({ name }) => name);
    directlyScoped.push("workspaces");
    const classified = [
      ...WORKSPACE_DELETION_TAXONOMY.purge,
      ...WORKSPACE_DELETION_TAXONOMY.retainAnonymized,
    ];

    expect(directlyScoped.sort()).toEqual([...classified].sort());
  });

  it("quiesces atomically, recovers stages, then purges/anonymizes the full graph", async () => {
    const repo = new D1WorkspaceDeletionRepo(testEnv().DB);

    await expect(repo.requestTombstone(WORKSPACE_ID, NOW)).resolves.toBe(true);
    await expect(repo.isOperational(WORKSPACE_ID)).resolves.toBe(false);
    const tombstone = await testEnv()
      .DB.prepare(
        `SELECT deletion_state, deleted_at FROM workspaces WHERE id = ?`,
      )
      .bind(WORKSPACE_ID)
      .first<{ deletion_state: string; deleted_at: number | null }>();
    expect(tombstone).toEqual({
      deletion_state: "DELETION_PENDING",
      deleted_at: null,
    });
    await expect(
      testEnv().DB.prepare(
        `SELECT enabled FROM notification_channels WHERE workspace_id = ?`,
      ).bind(WORKSPACE_ID).first<{ enabled: number }>(),
    ).resolves.toEqual({ enabled: 0 });
    await expect(
      testEnv().DB.prepare(
        `SELECT status, dispatch_state, error_sanitized
         FROM notification_deliveries WHERE workspace_id = ?`,
      ).bind(WORKSPACE_ID).first(),
    ).resolves.toEqual({
      status: "FAILED",
      dispatch_state: "CONFIRMED",
      error_sanitized: "workspace deletion requested",
    });
    await expect(
      testEnv().DB.prepare(
        `SELECT status, billable, finished_at FROM test_runs WHERE id = 'run_delete'`,
      ).first(),
    ).resolves.toEqual({ status: "SYSTEM_ERROR", billable: 0, finished_at: NOW });
    await expect(
      testEnv().DB.prepare(
        `SELECT status, system_error_code FROM test_attempts WHERE id = 'att_delete'`,
      ).first(),
    ).resolves.toEqual({
      status: "SYSTEM_ERROR",
      system_error_code: "WORKSPACE_DELETED",
    });
    expect(await count("pending_overage_periods", "WHERE workspace_id = ?", WORKSPACE_ID)).toBe(0);
    expect(await count("paddle_checkout_intents", "WHERE workspace_id = ?", WORKSPACE_ID)).toBe(0);
    expect(await count("check_execution_claims")).toBe(0);
    await expect(
      testEnv().DB.prepare(
        `SELECT quarantined_at FROM queue_outbox WHERE id = 'out_delete'`,
      ).first(),
    ).resolves.toEqual({ quarantined_at: NOW });
    await expect(
      testEnv().DB.prepare(
        `SELECT quarantined_at FROM durable_jobs WHERE id = 'job_delete'`,
      ).first(),
    ).resolves.toEqual({ quarantined_at: NOW });

    await expect(
      repo.claimDue({ now: NOW, staleBefore: 0, workspaceId: WORKSPACE_ID }),
    ).resolves.toEqual({
      workspaceId: WORKSPACE_ID,
      stage: "CANCELLATION_PENDING",
      attemptCount: 0,
    });
    await repo.markCancellationSucceeded(WORKSPACE_ID, NOW + 1);
    await expect(
      repo.claimDue({
        now: NOW + 1,
        staleBefore: 0,
        workspaceId: WORKSPACE_ID,
      }),
    ).resolves.toEqual({
      workspaceId: WORKSPACE_ID,
      stage: "PURGE_PENDING",
      attemptCount: 0,
    });
    await expect(repo.listArtifactStorageKeys(WORKSPACE_ID)).resolves.toEqual([
      "ws/ws_delete_all/run/run_delete/private.jpg",
    ]);
    await repo.purgeAndAnonymize(WORKSPACE_ID, NOW + 2);

    for (const table of WORKSPACE_DELETION_TAXONOMY.purge) {
      expect(
        await count(table, "WHERE workspace_id = ?", WORKSPACE_ID),
        table,
      ).toBe(0);
    }
    for (const table of WORKSPACE_DELETION_TAXONOMY.purgeIndirect) {
      expect(await count(table), table).toBe(0);
    }
    const remainingActivity = await testEnv()
      .DB.prepare("SELECT workspace_id FROM activity_events")
      .all<{ workspace_id: string }>();
    expect(remainingActivity.results).toEqual([{ workspace_id: "ws_other" }]);
    await expect(
      testEnv().DB.prepare(
        `SELECT redeemed_workspace_id FROM subscription_grants
         WHERE id = 'grant_delete'`,
      ).first(),
    ).resolves.toEqual({ redeemed_workspace_id: null });
    await expect(
      testEnv().DB.prepare(
        `SELECT name, slug, timezone, owner_user_id, deletion_state,
                deletion_completed_at
         FROM workspaces WHERE id = ?`,
      ).bind(WORKSPACE_ID).first(),
    ).resolves.toEqual({
      name: "Deleted workspace",
      slug: `deleted-${WORKSPACE_ID}`,
      timezone: "UTC",
      owner_user_id: `deleted:${WORKSPACE_ID}`,
      deletion_state: "COMPLETED",
      deletion_completed_at: NOW + 2,
    });
    await expect(
      testEnv().DB.prepare(
        `SELECT actor_user_id, resource_id, metadata_json, ip
         FROM audit_logs WHERE workspace_id = ?`,
      ).bind(WORKSPACE_ID).first(),
    ).resolves.toEqual({
      actor_user_id: null,
      resource_id: null,
      metadata_json: '{"retainedFor":"security_and_legal"}',
      ip: null,
    });
    await expect(
      testEnv().DB.prepare(
        `SELECT provider_customer_id, provider_subscription_id, status,
                update_payment_url, cancel_url
         FROM subscriptions WHERE workspace_id = ?`,
      ).bind(WORKSPACE_ID).first(),
    ).resolves.toEqual({
      provider_customer_id: null,
      provider_subscription_id: "sub_keep_for_legal",
      status: "CANCELED",
      update_payment_url: null,
      cancel_url: null,
    });
    await expect(
      testEnv().DB.prepare(
        `SELECT test_run_id, idempotency_key, billable, reversed_at
         FROM usage_events WHERE workspace_id = ?`,
      ).bind(WORKSPACE_ID).first(),
    ).resolves.toEqual({
      test_run_id: "deleted:use_delete",
      idempotency_key: "retained:use_delete",
      billable: 0,
      reversed_at: NOW,
    });
    await expect(
      testEnv().DB.prepare(
        `SELECT delivery_id, provider_transaction_id, description,
                idempotency_key
         FROM alert_credit_entries WHERE workspace_id = ?`,
      ).bind(WORKSPACE_ID).first(),
    ).resolves.toEqual({
      delivery_id: null,
      provider_transaction_id: "txn_credit_keep",
      description: "Retained financial ledger entry",
      idempotency_key: "retained:ace_delete",
    });
    expect(await count("overage_reports", "WHERE workspace_id = ?", WORKSPACE_ID)).toBe(1);

    // A delayed checkout/subscription webhook must not silently reactivate
    // billing after completion: it is scrubbed and reopens durable cancel work.
    await testEnv().DB.prepare(
      `UPDATE subscriptions
       SET status = 'ACTIVE', provider_customer_id = 'ctm_late',
           update_payment_url = 'https://buyer.test/late?token=secret'
       WHERE workspace_id = ?`,
    ).bind(WORKSPACE_ID).run();
    await expect(
      testEnv().DB.prepare(
        `SELECT deletion_state, deletion_retry_at
         FROM workspaces WHERE id = ?`,
      ).bind(WORKSPACE_ID).first(),
    ).resolves.toEqual({
      deletion_state: "CANCELLATION_PENDING",
      deletion_retry_at: 0,
    });
    await expect(
      testEnv().DB.prepare(
        `SELECT status, provider_customer_id, update_payment_url
         FROM subscriptions WHERE workspace_id = ?`,
      ).bind(WORKSPACE_ID).first(),
    ).resolves.toEqual({
      status: "ACTIVE",
      provider_customer_id: null,
      update_payment_url: null,
    });
  });

  it("database-fences new provider work after the tombstone", async () => {
    const repo = new D1WorkspaceDeletionRepo(testEnv().DB);
    await repo.requestTombstone(WORKSPACE_ID, NOW);

    await expect(
      testEnv().DB.prepare(
        `INSERT INTO notification_deliveries
          (id, workspace_id, notification_channel_id, event_type, status,
           created_at)
         VALUES ('del_after', ?, 'ch_delete', 'TEST', 'PENDING', ?)`,
      ).bind(WORKSPACE_ID, NOW).run(),
    ).rejects.toThrow("ZENGUY_WORKSPACE_DELETION_TOMBSTONE");
    await expect(
      testEnv().DB.prepare(
        `INSERT INTO test_runs
          (id, workspace_id, source, status, snapshot_json, queued_at,
           created_at)
         VALUES ('run_after', ?, 'MANUAL', 'QUEUED', '{}', ?, ?)`,
      ).bind(WORKSPACE_ID, NOW, NOW).run(),
    ).rejects.toThrow("ZENGUY_WORKSPACE_DELETION_TOMBSTONE");
  });
});
