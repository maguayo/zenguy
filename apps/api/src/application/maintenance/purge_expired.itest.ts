import { FixedClock } from "../../shared/clock";
import { freshDb, testEnv } from "../../test/helpers";
import { D1ArtifactRepo } from "../../infrastructure/db/artifact_repo";
import { D1CheckRepo } from "../../infrastructure/db/check_repo";
import { D1CleanupRepo } from "../../infrastructure/db/cleanup_repo";
import { PurgeExpired } from "./purge_expired";

const DAY_MS = 86_400_000;
const NOW = 100 * DAY_MS;
const RETENTION_EDGE = NOW - 30 * DAY_MS;
const EMAIL_EDGE = NOW - 7 * DAY_MS;
const DATA_KEY_IDS = {
  ws_ops: "dek-EEEEEEEEEEEEEEEEEEEEEEEE",
  ws_deleted_old: "dek-AAAAAAAAAAAAAAAAAAAAAAAA",
  ws_deleted_edge: "dek-CCCCCCCCCCCCCCCCCCCCCCCC",
} as const;

class RecordingStorage {
  readonly deleted: string[][] = [];

  async delete(keys: string[]): Promise<void> {
    this.deleted.push([...keys]);
  }
}

function statement(sql: string, ...values: unknown[]): D1PreparedStatement {
  return testEnv().DB.prepare(sql).bind(...values);
}

function workspace(id: string, _deletedAt: number | null): D1PreparedStatement {
  return statement(
    `INSERT INTO workspaces
      (id, name, slug, timezone, owner_user_id, created_at, updated_at,
       deleted_at, deletion_state)
     VALUES (?, ?, ?, 'UTC', 'usr_cleanup', 0, 0, NULL, 'ACTIVE')`,
    id,
    id,
    id,
  );
}

function browserTest(id: string, workspaceId: string): D1PreparedStatement {
  return statement(
    `INSERT INTO browser_tests
      (id, workspace_id, name, start_url, instructions, device,
       interval_hours, max_retries, next_run_at, created_at, updated_at)
     VALUES (?, ?, ?, 'https://example.com', 'Verify', 'DESKTOP', 1, 0, ?, 0, 0)`,
    id,
    workspaceId,
    id,
    NOW,
  );
}

function monitor(id: string, workspaceId: string): D1PreparedStatement {
  return statement(
    `INSERT INTO uptime_monitors
      (id, workspace_id, name, url, method, frequency_seconds, max_retries,
       next_check_at, created_at, updated_at)
     VALUES (?, ?, ?, 'https://example.com/health', 'GET', 300, 0, ?, 0, 0)`,
    id,
    workspaceId,
    id,
    NOW,
  );
}

function channel(id: string, workspaceId: string): D1PreparedStatement {
  const dataKeyId = DATA_KEY_IDS[workspaceId as keyof typeof DATA_KEY_IDS];
  if (dataKeyId === undefined) throw new Error("Missing synthetic data key");
  return statement(
    `INSERT INTO notification_channels
      (id, workspace_id, name, type, encrypted_config, created_at, updated_at)
     VALUES (?, ?, ?, 'EMAIL', ?, 0, 0)`,
    id,
    workspaceId,
    id,
    `v4:${dataKeyId}:AAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB`,
  );
}

function invitation(
  id: string,
  workspaceId: string,
  expiresAt: number,
): D1PreparedStatement {
  return statement(
    `INSERT INTO workspace_invitations
      (id, workspace_id, email, role, token_hash, invited_by, expires_at, created_at)
     VALUES (?, ?, ?, 'MEMBER', ?, 'usr_cleanup', ?, 0)`,
    id,
    workspaceId,
    `${id}@example.com`,
    `hash_${id}`,
    expiresAt,
  );
}

function runRow(
  id: string,
  browserTestId: string | null,
  source: "VALIDATION" | "MANUAL",
  finishedAt: number,
): D1PreparedStatement {
  return statement(
    `INSERT INTO test_runs
      (id, workspace_id, browser_test_id, source, status, snapshot_json,
       queued_at, finished_at, created_at)
     VALUES (?, 'ws_ops', ?, ?, 'PASSED', '{}', 0, ?, 0)`,
    id,
    browserTestId,
    source,
    finishedAt,
  );
}

function attempt(id: string, runId: string): D1PreparedStatement {
  return statement(
    `INSERT INTO test_attempts
      (id, test_run_id, attempt_index, status, queued_at, created_at)
     VALUES (?, ?, 0, 'PASSED', 0, 0)`,
    id,
    runId,
  );
}

function step(id: string, attemptId: string): D1PreparedStatement {
  return statement(
    `INSERT INTO run_steps
      (id, attempt_id, sequence, timestamp, action_type, description, result, created_at)
     VALUES (?, ?, 0, 0, 'inspect', 'Verified', 'OK', 0)`,
    id,
    attemptId,
  );
}

function artifact(input: {
  id: string;
  runId: string;
  attemptId: string;
  key: string;
  expiresAt: number;
}): D1PreparedStatement {
  return statement(
    `INSERT INTO run_artifacts
      (id, workspace_id, run_id, attempt_id, type, storage_key, mime_type,
       size_bytes, created_at, expires_at)
     VALUES (?, 'ws_ops', ?, ?, 'SCREENSHOT', ?, 'image/jpeg', 1, 0, ?)`,
    input.id,
    input.runId,
    input.attemptId,
    input.key,
    input.expiresAt,
  );
}

async function ids(table: string): Promise<string[]> {
  const rows = await testEnv()
    .DB.prepare(`SELECT id FROM ${table} ORDER BY id ASC`)
    .all<{ id: string }>();
  return rows.results.map((row) => row.id);
}

describe("PurgeExpired with D1", () => {
  beforeEach(freshDb);

  it("purges only the old side while preserving billing, audit, and incident history", async () => {
    await testEnv().DB.batch([
      statement(
        `INSERT INTO users (id, name, email, password_hash, created_at, updated_at)
         VALUES ('usr_cleanup', 'Cleanup', 'cleanup@example.com', 'hash', 0, 0)`,
      ),
      workspace("ws_ops", null),
      workspace("ws_deleted_old", RETENTION_EDGE - 1),
      workspace("ws_deleted_edge", RETENTION_EDGE),
      statement(
        `INSERT INTO workspace_data_encryption_keys
          (workspace_id, data_key_id, generation, wrapping_key_id, wrap_version,
           wrapped_key, active, created_at, updated_at, retired_at)
         VALUES
          ('ws_ops', 'dek-EEEEEEEEEEEEEEEEEEEEEEEE', 1, 'key-cleanup', 1,
           'w1:key-cleanup:EEEEEEEEEEEEEEEE:FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF',
           1, 0, 0, NULL),
          ('ws_deleted_old', 'dek-AAAAAAAAAAAAAAAAAAAAAAAA', 1, 'key-cleanup', 1,
           'w1:key-cleanup:AAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
           1, 0, 0, NULL),
          ('ws_deleted_edge', 'dek-CCCCCCCCCCCCCCCCCCCCCCCC', 1, 'key-cleanup', 1,
           'w1:key-cleanup:CCCCCCCCCCCCCCCC:DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
           1, 0, 0, NULL)`,
      ),
      browserTest("bt_ops", "ws_ops"),
      browserTest("bt_deleted_old", "ws_deleted_old"),
      browserTest("bt_deleted_edge", "ws_deleted_edge"),
      monitor("mon_ops", "ws_ops"),
      monitor("mon_deleted_old", "ws_deleted_old"),
      monitor("mon_deleted_edge", "ws_deleted_edge"),
      channel("ch_ops", "ws_ops"),
      channel("ch_deleted_old", "ws_deleted_old"),
      channel("ch_deleted_edge", "ws_deleted_edge"),
      statement(
        `INSERT INTO workspace_secrets
          (id, workspace_id, key, encrypted_value, encryption_version,
           allowed_domains, created_at, updated_at)
         VALUES
          ('sec_old', 'ws_deleted_old', 'OLD',
           'v4:dek-AAAAAAAAAAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
           4, '[]', 0, 0),
          ('sec_edge', 'ws_deleted_edge', 'EDGE',
           'v4:dek-CCCCCCCCCCCCCCCCCCCCCCCC:CCCCCCCCCCCCCCCC:DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
           4, '[]', 0, 0)`,
      ),
      statement(
        `INSERT INTO workspace_members (id, workspace_id, user_id, role, joined_at)
         VALUES ('mem_old', 'ws_deleted_old', 'usr_cleanup', 'OWNER', 0),
                ('mem_edge', 'ws_deleted_edge', 'usr_cleanup', 'OWNER', 0)`,
      ),
      invitation("inv_auth_old", "ws_ops", RETENTION_EDGE - 1),
      invitation("inv_auth_edge", "ws_ops", RETENTION_EDGE),
      invitation("inv_workspace_old", "ws_deleted_old", NOW + DAY_MS),
      invitation("inv_workspace_edge", "ws_deleted_edge", NOW + DAY_MS),
      statement(
        `INSERT INTO browser_test_channels (browser_test_id, notification_channel_id)
         VALUES ('bt_deleted_old', 'ch_deleted_old'),
                ('bt_deleted_edge', 'ch_deleted_edge')`,
      ),
      statement(
        `INSERT INTO uptime_monitor_channels (uptime_monitor_id, notification_channel_id)
         VALUES ('mon_deleted_old', 'ch_deleted_old'),
                ('mon_deleted_edge', 'ch_deleted_edge')`,
      ),
      runRow("run_old_validation", null, "VALIDATION", RETENTION_EDGE - 1),
      runRow("run_edge", "bt_ops", "MANUAL", RETENTION_EDGE),
      attempt("att_old", "run_old_validation"),
      attempt("att_edge", "run_edge"),
      step("step_old", "att_old"),
      step("step_edge", "att_edge"),
      artifact({
        id: "art_old_run",
        runId: "run_old_validation",
        attemptId: "att_old",
        key: "key-run-old",
        expiresAt: NOW + DAY_MS,
      }),
      artifact({
        id: "art_orphan_expired",
        runId: "run_edge",
        attemptId: "att_edge",
        key: "key-orphan-expired",
        expiresAt: NOW,
      }),
      artifact({
        id: "art_edge_keep",
        runId: "run_edge",
        attemptId: "att_edge",
        key: "key-edge-keep",
        expiresAt: NOW + DAY_MS,
      }),
      statement(
        `INSERT INTO uptime_checks
          (id, workspace_id, uptime_monitor_id, cycle_id, attempt_index,
           status, checked_at, created_at)
         VALUES ('chk_old', 'ws_ops', 'mon_ops', 'cyc_old', 0, 'PASSED', ?, ?),
                ('chk_edge', 'ws_ops', 'mon_ops', 'cyc_edge', 0, 'PASSED', ?, ?)`,
        RETENTION_EDGE - 1,
        RETENTION_EDGE - 1,
        RETENTION_EDGE,
        RETENTION_EDGE,
      ),
      statement(
        `INSERT INTO incidents
          (id, workspace_id, resource_type, uptime_monitor_id, status,
           opened_at, resolved_at, last_event_at, created_at)
         VALUES ('inc_keep', 'ws_ops', 'UPTIME_MONITOR', 'mon_ops', 'RESOLVED', 1, 2, 2, 1)`,
      ),
      statement(
        `INSERT INTO incident_events
          (id, incident_id, type, message, created_at)
         VALUES ('evt_keep', 'inc_keep', 'RESOLVED', 'Recovered', 2)`,
      ),
      statement(
        `INSERT INTO notification_deliveries
          (id, workspace_id, incident_id, notification_channel_id, event_type,
           status, created_at)
         VALUES ('del_old', 'ws_ops', 'inc_keep', 'ch_ops', 'FAILURE', 'SENT', ?),
                ('del_edge', 'ws_ops', 'inc_keep', 'ch_ops', 'RECOVERY', 'SENT', ?)`,
        RETENTION_EDGE - 1,
        RETENTION_EDGE,
      ),
      statement(
        `INSERT INTO email_tokens
          (id, user_id, type, token_hash, expires_at, created_at)
         VALUES ('email_old', 'usr_cleanup', 'VERIFY_EMAIL', 'email_hash_old', ?, 0),
                ('email_edge', 'usr_cleanup', 'RESET_PASSWORD', 'email_hash_edge', ?, 0)`,
        EMAIL_EDGE - 1,
        EMAIL_EDGE,
      ),
      statement(
        `INSERT INTO refresh_tokens
          (id, user_id, token_hash, expires_at, revoked_at, created_at)
         VALUES ('refresh_expired_old', 'usr_cleanup', 'refresh_hash_old', ?, NULL, 0),
                ('refresh_expired_edge', 'usr_cleanup', 'refresh_hash_edge', ?, NULL, 0),
                ('refresh_revoked_old', 'usr_cleanup', 'refresh_hash_rev_old', ?, ?, 0),
                ('refresh_revoked_edge', 'usr_cleanup', 'refresh_hash_rev_edge', ?, ?, 0)`,
        RETENTION_EDGE - 1,
        RETENTION_EDGE,
        NOW + DAY_MS,
        RETENTION_EDGE - 1,
        NOW + DAY_MS,
        RETENTION_EDGE,
      ),
      statement(
        `INSERT INTO admin_sessions
          (id_hash, user_id, email, auth_version, created_at, expires_at, revoked_at)
         VALUES ('admin_expired', 'usr_cleanup', 'cleanup@example.com', 1, 0, ?, NULL),
                ('admin_expiry_edge', 'usr_cleanup', 'cleanup@example.com', 1, 0, ?, NULL),
                ('admin_revoked', 'usr_cleanup', 'cleanup@example.com', 1, 0, ?, ?),
                ('admin_active', 'usr_cleanup', 'cleanup@example.com', 1, 0, ?, NULL)`,
        NOW - 1,
        NOW,
        NOW + DAY_MS,
        NOW - 1,
        NOW + DAY_MS,
      ),
      statement(
        `INSERT INTO rate_limit_windows
          (rate_key, window_start, request_count, expires_at)
         VALUES ('expired', 0, 1, ?), ('edge', 1, 1, ?), ('future', 2, 1, ?)`,
        NOW - 1,
        NOW,
        NOW + 1,
      ),
      statement(
        `INSERT INTO subscriptions
          (id, workspace_id, status, created_at, updated_at)
         VALUES ('sub_keep', 'ws_ops', 'ACTIVE', 0, 0)`,
      ),
      statement(
        `INSERT INTO usage_events
          (id, workspace_id, test_run_id, idempotency_key, occurred_at, created_at)
         VALUES ('use_keep', 'ws_ops', 'run_old_validation', 'use-key', 0, 0)`,
      ),
      statement(
        `INSERT INTO overage_reports
          (id, workspace_id, period_start, period_end, overage_runs,
           amount_cents, reported_at)
         VALUES ('ovr_keep', 'ws_ops', 0, 1, 1, 20, 1)`,
      ),
      statement(
        `INSERT INTO audit_logs
          (id, workspace_id, action, created_at)
         VALUES ('aud_keep', 'ws_ops', 'test.created', 0)`,
      ),
    ]);
    // The legacy retention fallback only handles sagas that have completed;
    // active/cancellation-pending tombstones belong to WorkspaceDeletionSaga.
    await testEnv().DB.batch([
      statement(
        `UPDATE workspaces SET deleted_at = ?, deletion_state = 'COMPLETED'
         WHERE id = 'ws_deleted_old'`,
        RETENTION_EDGE - 1,
      ),
      statement(
        `UPDATE workspaces SET deleted_at = ?, deletion_state = 'COMPLETED'
         WHERE id = 'ws_deleted_edge'`,
        RETENTION_EDGE,
      ),
    ]);

    const storage = new RecordingStorage();
    const purge = new PurgeExpired(
      new D1CleanupRepo(testEnv().DB),
      new D1ArtifactRepo(testEnv().DB),
      new D1CheckRepo(testEnv().DB),
      storage,
      new FixedClock(NOW),
      () => undefined,
    );

    await expect(purge.execute()).resolves.toEqual({
      runs: 1,
      attempts: 1,
      steps: 1,
      artifacts: 2,
      checks: 1,
      deliveries: 1,
      rateLimits: 2,
      activityEvents: 0,
      tokens: 8,
    });
    expect(storage.deleted.flat()).toEqual([
      "key-run-old",
      "key-orphan-expired",
    ]);
    expect(await ids("test_runs")).toEqual(["run_edge"]);
    expect(await ids("test_attempts")).toEqual(["att_edge"]);
    expect(await ids("run_steps")).toEqual(["step_edge"]);
    expect(await ids("run_artifacts")).toEqual(["art_edge_keep"]);
    expect(await ids("uptime_checks")).toEqual(["chk_edge"]);
    expect(await ids("notification_deliveries")).toEqual(["del_edge"]);
    expect(await ids("email_tokens")).toEqual(["email_edge"]);
    expect(await ids("refresh_tokens")).toEqual([
      "refresh_expired_edge",
      "refresh_revoked_edge",
    ]);
    const adminSessions = await testEnv().DB.prepare(
      "SELECT id_hash FROM admin_sessions ORDER BY id_hash ASC",
    ).all<{ id_hash: string }>();
    expect(adminSessions.results.map((row) => row.id_hash)).toEqual([
      "admin_active",
    ]);
    const rateLimits = await testEnv().DB.prepare(
      "SELECT rate_key FROM rate_limit_windows ORDER BY rate_key ASC",
    ).all<{ rate_key: string }>();
    expect(rateLimits.results.map((row) => row.rate_key)).toEqual(["future"]);
    expect(await ids("workspace_invitations")).toEqual([
      "inv_auth_edge",
      "inv_workspace_edge",
    ]);
    expect(await ids("workspace_secrets")).toEqual(["sec_edge"]);
    const retainedDataKeys = await testEnv()
      .DB.prepare(
        `SELECT workspace_id FROM workspace_data_encryption_keys
         ORDER BY workspace_id ASC`,
      )
      .all<{ workspace_id: string }>();
    expect(retainedDataKeys.results).toEqual([
      { workspace_id: "ws_deleted_edge" },
      { workspace_id: "ws_ops" },
    ]);
    expect(await ids("notification_channels")).toEqual([
      "ch_deleted_edge",
      "ch_ops",
    ]);
    expect(await ids("browser_tests")).toEqual([
      "bt_deleted_edge",
      "bt_ops",
    ]);
    expect(await ids("uptime_monitors")).toEqual([
      "mon_deleted_edge",
      "mon_ops",
    ]);
    expect(await ids("workspace_members")).toEqual(["mem_edge"]);
    const browserLinks = await testEnv().DB.prepare(
      `SELECT browser_test_id || ':' || notification_channel_id AS id
       FROM browser_test_channels ORDER BY id ASC`,
    ).all<{ id: string }>();
    expect(browserLinks.results.map((row) => row.id)).toEqual([
      "bt_deleted_edge:ch_deleted_edge",
    ]);
    const monitorLinks = await testEnv().DB.prepare(
      `SELECT uptime_monitor_id || ':' || notification_channel_id AS id
       FROM uptime_monitor_channels ORDER BY id ASC`,
    ).all<{ id: string }>();
    expect(monitorLinks.results.map((row) => row.id)).toEqual([
      "mon_deleted_edge:ch_deleted_edge",
    ]);
    expect(await ids("incidents")).toEqual(["inc_keep"]);
    expect(await ids("incident_events")).toEqual(["evt_keep"]);
    expect(await ids("subscriptions")).toEqual(["sub_keep"]);
    expect(await ids("usage_events")).toEqual(["use_keep"]);
    expect(await ids("overage_reports")).toEqual(["ovr_keep"]);
    expect(await ids("audit_logs")).toEqual(["aud_keep"]);
    expect(await ids("workspaces")).toEqual([
      "ws_deleted_edge",
      "ws_deleted_old",
      "ws_ops",
    ]);

    await expect(purge.execute()).resolves.toEqual({
      runs: 0,
      attempts: 0,
      steps: 0,
      artifacts: 0,
      checks: 0,
      deliveries: 0,
      rateLimits: 0,
      activityEvents: 0,
      tokens: 0,
    });
  });
});
