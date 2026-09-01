import {
  ACCOUNT_DELETION_DIRECT_REFERENCES,
  ACCOUNT_DELETION_INDIRECT_REFERENCES,
} from "../../domain/users/account_deletion";
import { sha256Hex } from "../../shared/crypto";
import { freshDb, testEnv } from "../../test/helpers";
import { D1AccountDeletionRepo } from "./account_deletion_repo";

const USER_ID = "usr_erase_complete";
const OTHER_USER_ID = "usr_keep_owner";
const EMAIL = "erase-complete@example.com";
const NOW = 50_000;

function statement(sql: string, ...values: unknown[]): D1PreparedStatement {
  return testEnv().DB.prepare(sql).bind(...values);
}

async function seedAccountGraph(): Promise<void> {
  const userDigest = await sha256Hex(USER_ID);
  const emailDigest = await sha256Hex(EMAIL);
  await testEnv().DB.batch([
    statement(
      `INSERT INTO users
        (id, name, email, password_hash, email_verified_at, auth_version,
         created_at, updated_at)
       VALUES (?, 'Erase Complete', ?, 'password-hash', 1, 1, 1, 1)`,
      USER_ID,
      EMAIL,
    ),
    statement(
      `INSERT INTO users
        (id, name, email, password_hash, auth_version, created_at, updated_at)
       VALUES (?, 'Keep Owner', 'keep-owner@example.com', 'hash', 1, 1, 1)`,
      OTHER_USER_ID,
    ),
    statement(
      `INSERT INTO workspaces
        (id, name, slug, timezone, owner_user_id, created_at, updated_at)
       VALUES ('ws_joined_erase', 'Joined workspace', 'joined-erase', 'UTC', ?, 1, 1)`,
      OTHER_USER_ID,
    ),
    statement(
      `INSERT INTO workspace_data_encryption_keys
        (workspace_id, data_key_id, generation, wrapping_key_id, wrap_version,
         wrapped_key, active, created_at, updated_at, retired_at)
       VALUES ('ws_joined_erase', 'dek-AAAAAAAAAAAAAAAAAAAAAAAA', 1,
               'key-account-erase', 1,
               'w1:key-account-erase:AAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
               1, 1, 1, NULL)`,
    ),
    statement(
      `INSERT INTO workspace_members
        (id, workspace_id, user_id, role, invited_by, joined_at)
       VALUES ('mem_erase', 'ws_joined_erase', ?, 'ADMIN', ?, 1)`,
      USER_ID,
      OTHER_USER_ID,
    ),
    statement(
      `INSERT INTO workspace_members
        (id, workspace_id, user_id, role, invited_by, joined_at)
       VALUES ('mem_keep', 'ws_joined_erase', ?, 'OWNER', ?, 1)`,
      OTHER_USER_ID,
      USER_ID,
    ),
    statement(
      `INSERT INTO email_tokens
        (id, user_id, type, token_hash, expires_at, created_at)
       VALUES ('email_erase', ?, 'RESET_PASSWORD', 'email-token-secret', 999999, 1)`,
      USER_ID,
    ),
    statement(
      `INSERT INTO refresh_tokens
        (id, user_id, token_hash, expires_at, created_at)
       VALUES ('refresh_erase', ?, 'refresh-token-secret', 999999, 1)`,
      USER_ID,
    ),
    statement(
      `INSERT INTO admin_sessions
        (id_hash, user_id, email, auth_version, created_at, expires_at)
       VALUES ('admin-session-secret', ?, ?, 1, 1, 999999)`,
      USER_ID,
      EMAIL,
    ),
    statement(
      `INSERT INTO oauth_identities
        (provider, subject, user_id, email_at_link, created_at, updated_at)
       VALUES ('google', 'oauth-subject-secret', ?, ?, 1, 1)`,
      USER_ID,
      EMAIL,
    ),
    statement(
      `INSERT INTO user_legal_acceptances
        (user_id, terms_accepted_at, privacy_acknowledged_at, marketing_opt_in_at,
         legal_version, created_at)
       VALUES (?, 1, 1, 1, 'private-legal-version', 1)`,
      USER_ID,
    ),
    statement(
      `INSERT INTO user_push_devices
        (id, user_id, token, platform, device_name, app_version, enabled,
         last_seen_at, created_at, updated_at)
       VALUES ('push_erase', ?, 'ExponentPushToken[private]', 'ios',
               'Personal iPhone', '0.2.2', 1, 1, 1, 1)`,
      USER_ID,
    ),
    statement(
      `INSERT INTO workspace_invitations
        (id, workspace_id, email, role, token_hash, invited_by, expires_at,
         created_at)
       VALUES ('invite_by_erase', 'ws_joined_erase', 'someone@example.com',
               'MEMBER', 'invite-by-token-secret', ?, 999999, 1)`,
      USER_ID,
    ),
    statement(
      `INSERT INTO workspace_invitations
        (id, workspace_id, email, role, token_hash, invited_by, expires_at,
         accepted_at, created_at)
       VALUES ('invite_to_erase', 'ws_joined_erase', ?, 'ADMIN',
               'invite-to-token-secret', ?, 999999, 2, 1)`,
      EMAIL,
      OTHER_USER_ID,
    ),
    statement(
      `INSERT INTO audit_logs
        (id, workspace_id, actor_user_id, action, resource_type, resource_id,
         metadata_json, ip, created_at)
       VALUES ('audit_actor_erase', 'ws_joined_erase', ?, 'browser_test.created',
               'browser_test', 'bt_erase', '{"name":"Personal audit detail"}',
               '203.0.113.20', 1)`,
      USER_ID,
    ),
    statement(
      `INSERT INTO audit_logs
        (id, workspace_id, actor_user_id, action, resource_type, resource_id,
         metadata_json, ip, created_at)
       VALUES ('audit_target_erase', 'ws_joined_erase', ?, 'member.removed',
               'member', ?, ?, '203.0.113.21', 1)`,
      OTHER_USER_ID,
      USER_ID,
      JSON.stringify({ targetUserId: USER_ID, role: "ADMIN" }),
    ),
    statement(
      `INSERT INTO activity_events
        (id, type, user_id, workspace_id, source, resource_type, resource_id,
         properties_json, occurred_at)
       VALUES ('activity_erase', 'browser_test.viewed', ?, 'ws_joined_erase',
               'app', 'browser_test', 'bt_erase',
               '{"private":"Personal activity detail"}', 1)`,
      USER_ID,
    ),
    statement(
      `INSERT INTO workspace_secrets
        (id, workspace_id, key, encrypted_value, encryption_version,
         allowed_domains, description, created_by, created_at, updated_at)
       VALUES ('secret_erase', 'ws_joined_erase', 'PASSWORD',
               'v4:dek-AAAAAAAAAAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
               4, '[]', NULL, ?, 1, 1)`,
      USER_ID,
    ),
    statement(
      `INSERT INTO notification_channels
        (id, workspace_id, name, type, encrypted_config, enabled, created_by,
         created_at, updated_at)
       VALUES ('channel_erase', 'ws_joined_erase', 'Personal destination', 'EMAIL',
               'v4:dek-AAAAAAAAAAAAAAAAAAAAAAAA:CCCCCCCCCCCCCCCC:DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
               1, ?, 1, 1)`,
      USER_ID,
    ),
    statement(
      `INSERT INTO browser_tests
        (id, workspace_id, name, start_url, instructions, device,
         interval_hours, max_retries, next_run_at, created_by, updated_by,
         created_at, updated_at)
       VALUES ('bt_erase', 'ws_joined_erase', 'Retained team test',
               'https://example.com', 'Retained team instructions', 'DESKTOP',
               1, 0, 999999, ?, ?, 1, 1)`,
      USER_ID,
      USER_ID,
    ),
    statement(
      `INSERT INTO test_runs
        (id, workspace_id, browser_test_id, source, status, snapshot_json,
         queued_at, finished_at, triggered_by_user_id, created_at)
       VALUES ('run_erase', 'ws_joined_erase', 'bt_erase', 'MANUAL', 'PASSED', ?,
               1, 2, ?, 1)`,
      JSON.stringify({
        modelName: "local-model",
        irreversibleAuthorization: {
          approvedByUserId: USER_ID,
          signature: "authorization-secret",
        },
      }),
      USER_ID,
    ),
    statement(
      `INSERT INTO uptime_monitors
        (id, workspace_id, name, url, method, frequency_seconds, max_retries,
         next_check_at, created_by, created_at, updated_at)
       VALUES ('monitor_erase', 'ws_joined_erase', 'Retained monitor',
               'https://example.com/health', 'GET', 300, 0, 999999, ?, 1, 1)`,
      USER_ID,
    ),
    statement(
      `INSERT INTO workspace_api_keys
        (id, workspace_id, name, key_prefix, key_hash, scopes_json, expires_at,
         created_by, created_at)
       VALUES ('api_key_erase', 'ws_joined_erase', 'Personal key', 'zg_live_',
               'api-key-secret', '["workspace:read"]', 999999, ?, 1)`,
      USER_ID,
    ),
    statement(
      `INSERT INTO status_pages
        (id, workspace_id, slug, title, theme, created_by, created_at, updated_at)
       VALUES ('status_erase', 'ws_joined_erase', 'retained-status',
               'Retained status', 'SYSTEM', ?, 1, 1)`,
      USER_ID,
    ),
    statement(
      `INSERT INTO incidents
        (id, workspace_id, resource_type, browser_test_id, status, opened_at,
         opened_by_run_id, last_event_at, created_at)
       VALUES ('incident_erase', 'ws_joined_erase', 'BROWSER_TEST', 'bt_erase',
               'RESOLVED', 1, 'run_erase', 1, 1)`,
    ),
    statement(
      `INSERT INTO incident_updates
        (id, incident_id, workspace_id, message, created_by, created_at)
       VALUES ('incident_update_erase', 'incident_erase', 'ws_joined_erase',
               'Retained update', ?, 1)`,
      USER_ID,
    ),
    statement(
      `INSERT INTO workspace_remote_ai_consents
        (workspace_id, provider, policy_version, accepted_by_user_id,
         accepted_at, revoked_by_user_id, revoked_at, updated_at)
       VALUES ('ws_joined_erase', 'openai', '2026-09-01-v1', ?, 1, ?, 2, 2)`,
      USER_ID,
      USER_ID,
    ),
    statement(
      `INSERT INTO subscription_grants
        (id, token_hash, issued_by_user_id, note, expires_at, created_at)
       VALUES ('grant_erase', 'grant-token-secret', ?,
               'Personal grant note', 999999, 1)`,
      USER_ID,
    ),
    statement(
      `INSERT INTO paddle_checkout_intents
        (id, workspace_id, actor_user_id, purpose, product_id, price_id,
         quantity, currency_code, amount_cents, created_at, expires_at)
       VALUES ('paddle_intent_erase', 'ws_joined_erase', ?, 'alert_credit',
               'credits', 'price-private', 1, 'EUR', 1000, 1, 999999)`,
      USER_ID,
    ),
    statement(
      `INSERT INTO stripe_checkout_intents
        (id, workspace_id, actor_user_id, purpose, product_id, price_id,
         quantity, currency_code, amount_cents, created_at, expires_at)
       VALUES ('stripe_intent_erase', 'ws_joined_erase', ?, 'alert_credit',
               'credits', 'price-private', 1, 'EUR', 1000, 1, 999999)`,
      USER_ID,
    ),
    statement(
      `INSERT INTO run_quota_counters
        (scope_kind, scope_id, window_kind, window_start, run_count)
       VALUES ('OWNER', ?, 'DAY', 0, 1)`,
      USER_ID,
    ),
    statement(
      `INSERT INTO rate_limit_windows
        (rate_key, window_start, request_count, expires_at)
       VALUES (?, 0, 1, 999999)`,
      `run_create:user:${USER_ID}`,
    ),
    statement(
      `INSERT INTO rate_limit_windows
        (rate_key, window_start, request_count, expires_at)
       VALUES (?, 0, 1, 999999)`,
      `account-delete:user:${userDigest}`,
    ),
    statement(
      `INSERT INTO rate_limit_windows
        (rate_key, window_start, request_count, expires_at)
       VALUES (?, 0, 1, 999999)`,
      `login:email:${emailDigest}`,
    ),
    statement(
      `INSERT INTO rate_limit_windows
        (rate_key, window_start, request_count, expires_at)
       VALUES ('keep:unrelated', 0, 1, 999999)`,
    ),
  ]);
}

async function count(table: string, where = "", ...values: unknown[]): Promise<number> {
  const row = await testEnv()
    .DB.prepare(`SELECT COUNT(*) AS value FROM ${table} ${where}`)
    .bind(...values)
    .first<{ value: number }>();
  return row?.value ?? 0;
}

describe("D1AccountDeletionRepo", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("classifies every direct account identifier in the final schema", async () => {
    const tables = await testEnv().DB.prepare(
      `SELECT name, sql FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    ).all<{ name: string; sql: string | null }>();
    const direct = tables.results
      .flatMap(({ name, sql }) => {
        if (sql === null) return [];
        const columns = [
          ...sql.matchAll(/(?:\(|,)\s*([a-z][a-z0-9_]*)\s+[^,)]+/giu),
        ]
          .map((match) => match[1]?.toLowerCase())
          .filter((column): column is string => column !== undefined)
          .filter(
            (column) =>
              (name === "users" && column === "id") ||
              column === "email" ||
              column === "email_at_link" ||
              /(?:^|_)(?:user_id|created_by|updated_by|invited_by)$/u.test(
                column,
              ),
          );
        return columns.map((column) => `${name}.${column}`);
      })
      .sort();

    expect(direct).toEqual([...ACCOUNT_DELETION_DIRECT_REFERENCES].sort());
    expect(ACCOUNT_DELETION_INDIRECT_REFERENCES).toEqual([
      "activity_events.properties_json/resource_id",
      "audit_logs.metadata_json/resource_id",
      "rate_limit_windows.rate_key",
      "run_quota_counters.scope_kind/scope_id",
      "test_runs.snapshot_json.irreversibleAuthorization",
    ]);
  });

  it("revokes, purges or anonymizes every reachable account surface", async () => {
    await seedAccountGraph();
    const repo = new D1AccountDeletionRepo(testEnv().DB);

    await repo.finalize({ userId: USER_ID, email: EMAIL, at: NOW });

    await expect(
      testEnv().DB.prepare(
        `SELECT name, email, email_verified_at, auth_version, deleted_at
         FROM users WHERE id = ?`,
      ).bind(USER_ID).first(),
    ).resolves.toEqual({
      name: "Deleted user",
      email: `deleted+${USER_ID}@redacted.invalid`,
      email_verified_at: null,
      auth_version: 2,
      deleted_at: NOW,
    });
    await expect(
      testEnv().DB.prepare(
        `SELECT revoked_at, token_hash FROM refresh_tokens WHERE id = 'refresh_erase'`,
      ).first(),
    ).resolves.toEqual({
      revoked_at: NOW,
      token_hash: expect.not.stringMatching(/secret/u),
    });
    await expect(
      testEnv().DB.prepare(
        `SELECT email, revoked_at FROM admin_sessions WHERE id_hash = 'admin-session-secret'`,
      ).first(),
    ).resolves.toEqual({
      email: `deleted+${USER_ID}@redacted.invalid`,
      revoked_at: NOW,
    });
    for (const table of [
      "email_tokens",
      "oauth_identities",
      "user_legal_acceptances",
      "user_push_devices",
      "paddle_checkout_intents",
      "stripe_checkout_intents",
    ]) {
      expect(await count(table), table).toBe(0);
    }
    await expect(
      testEnv().DB.prepare(
        `SELECT user_id, resource_id, properties_json
         FROM activity_events WHERE id = 'activity_erase'`,
      ).first(),
    ).resolves.toEqual({
      user_id: null,
      resource_id: null,
      properties_json: null,
    });
    for (const id of ["audit_actor_erase", "audit_target_erase"]) {
      await expect(
        testEnv().DB.prepare(
          `SELECT actor_user_id, resource_id, metadata_json, ip
           FROM audit_logs WHERE id = ?`,
        ).bind(id).first(),
      ).resolves.toMatchObject({
        metadata_json: '{"retainedFor":"security_and_legal"}',
      });
    }
    await expect(
      testEnv().DB.prepare(
        `SELECT actor_user_id, ip FROM audit_logs WHERE id = 'audit_actor_erase'`,
      ).first(),
    ).resolves.toEqual({ actor_user_id: null, ip: null });
    await expect(
      testEnv().DB.prepare(
        `SELECT resource_id FROM audit_logs WHERE id = 'audit_target_erase'`,
      ).first(),
    ).resolves.toEqual({ resource_id: null });
    await expect(
      testEnv().DB.prepare(
        `SELECT invited_by FROM workspace_members WHERE id = 'mem_keep'`,
      ).first(),
    ).resolves.toEqual({ invited_by: null });
    expect(await count("workspace_members", "WHERE id = 'mem_erase'")).toBe(0);
    await expect(
      testEnv().DB.prepare(
        `SELECT invited_by, revoked_at, token_hash
         FROM workspace_invitations WHERE id = 'invite_by_erase'`,
      ).first(),
    ).resolves.toMatchObject({
      invited_by: "deleted-user",
      revoked_at: NOW,
      token_hash: expect.not.stringMatching(/secret/u),
    });
    await expect(
      testEnv().DB.prepare(
        `SELECT email, token_hash FROM workspace_invitations
         WHERE id = 'invite_to_erase'`,
      ).first(),
    ).resolves.toMatchObject({
      email: `deleted+${USER_ID}@redacted.invalid`,
      token_hash: expect.not.stringMatching(/secret/u),
    });
    await expect(
      testEnv().DB.prepare(
        `SELECT created_by, updated_by FROM browser_tests WHERE id = 'bt_erase'`,
      ).first(),
    ).resolves.toEqual({ created_by: null, updated_by: null });
    const run = await testEnv().DB.prepare(
      `SELECT triggered_by_user_id, snapshot_json FROM test_runs WHERE id = 'run_erase'`,
    ).first<{ triggered_by_user_id: string | null; snapshot_json: string }>();
    expect(run?.triggered_by_user_id).toBeNull();
    expect(JSON.parse(run?.snapshot_json ?? "{}")).toEqual({
      modelName: "local-model",
    });
    for (const [table, id] of [
      ["workspace_secrets", "secret_erase"],
      ["uptime_monitors", "monitor_erase"],
      ["status_pages", "status_erase"],
      ["incident_updates", "incident_update_erase"],
    ] as const) {
      await expect(
        testEnv()
          .DB.prepare(`SELECT created_by FROM ${table} WHERE id = ?`)
          .bind(id)
          .first(),
      ).resolves.toEqual({ created_by: null });
    }
    await expect(
      testEnv().DB.prepare(
        `SELECT created_by, revoked_at FROM workspace_api_keys WHERE id = 'api_key_erase'`,
      ).first(),
    ).resolves.toEqual({ created_by: null, revoked_at: NOW });
    await expect(
      testEnv().DB.prepare(
        `SELECT created_by, enabled FROM notification_channels WHERE id = 'channel_erase'`,
      ).first(),
    ).resolves.toEqual({ created_by: null, enabled: 0 });
    await expect(
      testEnv().DB.prepare(
        `SELECT accepted_by_user_id, revoked_by_user_id
         FROM workspace_remote_ai_consents WHERE workspace_id = 'ws_joined_erase'`,
      ).first(),
    ).resolves.toEqual({ accepted_by_user_id: null, revoked_by_user_id: null });
    await expect(
      testEnv().DB.prepare(
        `SELECT issued_by_user_id, note, expires_at, token_hash
         FROM subscription_grants WHERE id = 'grant_erase'`,
      ).first(),
    ).resolves.toMatchObject({
      issued_by_user_id: "deleted-user",
      note: "Retained grant record",
      expires_at: NOW,
      token_hash: expect.not.stringMatching(/secret/u),
    });
    expect(
      await count(
        "run_quota_counters",
        "WHERE scope_kind IN ('USER', 'OWNER') AND scope_id = ?",
        USER_ID,
      ),
    ).toBe(0);
    const rateLimits = await testEnv().DB.prepare(
      "SELECT rate_key FROM rate_limit_windows ORDER BY rate_key",
    ).all<{ rate_key: string }>();
    expect(rateLimits.results).toEqual([{ rate_key: "keep:unrelated" }]);

    const serialized = JSON.stringify(
      await testEnv().DB.prepare(
        `SELECT name, email FROM users WHERE id = ?
         UNION ALL SELECT metadata_json, ip FROM audit_logs
         UNION ALL SELECT note, token_hash FROM subscription_grants`,
      ).bind(USER_ID).all(),
    );
    for (const privateValue of [
      EMAIL,
      "Erase Complete",
      "Personal audit detail",
      "Personal grant note",
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
  });
});
