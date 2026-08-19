import { spawn } from "node:child_process";
import { webcrypto } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PBKDF2_ITERATIONS = 100_000;
const OWNER_EMAIL = "marcos@aguayo.es";
const OWNER_PASSWORD = "abc123456";
const ADMIN_EMAIL = "ana@zenguy.dev";
const MEMBER_EMAIL = "luis@zenguy.dev";
const MEMBER_PASSWORD = "Password123!";
const LOCAL_DATABASE = "zenguy-db";
const STAGING_DATABASE = "zenguy-staging-db";
const STAGING_ENVIRONMENT = "staging";
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const API_DIRECTORY = path.resolve(SCRIPT_DIRECTORY, "..");
const GENERATED_SQL_PATH = path.join(SCRIPT_DIRECTORY, ".seed.generated.sql");
const encoder = new TextEncoder();

function parseArguments(argv) {
  const options = {
    dryRun: false,
    printCommand: false,
    remote: false,
    allowRemote: false,
    confirmStaging: false,
    environment: null,
    varsFile: path.join(API_DIRECTORY, ".dev.vars"),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--print-command") options.printCommand = true;
    else if (argument === "--remote") options.remote = true;
    else if (argument === "--allow-remote") options.allowRemote = true;
    else if (argument === "--confirm-staging") options.confirmStaging = true;
    else if (argument === "--env") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--env requires a value");
      }
      options.environment = value;
      index += 1;
    } else if (argument === "--vars-file") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--vars-file requires a path");
      }
      options.varsFile = path.resolve(process.cwd(), value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (options.remote) {
    if (options.environment !== STAGING_ENVIRONMENT) {
      throw new Error(
        "Remote seed target must be explicitly set with --env staging; production is never supported",
      );
    }
    if (!options.allowRemote || !options.confirmStaging) {
      throw new Error(
        "Remote staging seed requires both --allow-remote and --confirm-staging",
      );
    }
  } else if (
    options.environment !== null ||
    options.allowRemote ||
    options.confirmStaging
  ) {
    throw new Error(
      "--env, --allow-remote, and --confirm-staging are valid only with --remote",
    );
  }
  return options;
}

function parseVars(contents) {
  const values = new Map();
  for (const sourceLine of contents.split(/\r?\n/u)) {
    const line = sourceLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values.set(key, value);
  }
  return values;
}

function randomBytes(length) {
  return webcrypto.getRandomValues(new Uint8Array(length));
}

function base64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function exactBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const material = await webcrypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await webcrypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: exactBuffer(salt),
      iterations: PBKDF2_ITERATIONS,
    },
    material,
    256,
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${base64(salt)}$${base64(
    new Uint8Array(bits),
  )}`;
}

async function encryptSecret(plaintext, encryptionKey) {
  const iv = randomBytes(12);
  const key = await webcrypto.subtle.importKey(
    "raw",
    exactBuffer(encryptionKey),
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const ciphertext = await webcrypto.subtle.encrypt(
    { name: "AES-GCM", iv: exactBuffer(iv) },
    key,
    encoder.encode(plaintext),
  );
  return `v1:${base64(iv)}:${base64(new Uint8Array(ciphertext))}`;
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

const WIPE_STATEMENTS = [
  "DELETE FROM check_execution_claims;",
  "DELETE FROM durable_jobs;",
  "DELETE FROM queue_outbox;",
  "DELETE FROM uptime_checks;",
  "DELETE FROM uptime_monitor_channels;",
  "DELETE FROM uptime_monitors;",
  "DELETE FROM incident_events;",
  "DELETE FROM incidents;",
  "DELETE FROM run_steps;",
  "DELETE FROM run_artifacts;",
  "DELETE FROM test_attempts;",
  "DELETE FROM test_runs;",
  "DELETE FROM browser_test_channels;",
  "DELETE FROM browser_tests;",
  "DELETE FROM notification_deliveries;",
  "DELETE FROM notification_channels;",
  "DELETE FROM workspace_secrets;",
  "DELETE FROM workspace_api_keys;",
  "DELETE FROM pending_overage_periods;",
  "DELETE FROM overage_reports;",
  "DELETE FROM usage_events;",
  "DELETE FROM subscription_grants;",
  "DELETE FROM subscriptions;",
  "DELETE FROM audit_logs;",
  "DELETE FROM workspace_invitations;",
  "DELETE FROM workspace_members;",
  "DELETE FROM workspaces;",
  "DELETE FROM refresh_tokens;",
  "DELETE FROM email_tokens;",
  "DELETE FROM users;",
];

function runSnapshot(test, channelId) {
  return JSON.stringify({
    name: test.name,
    startUrl: test.startUrl,
    instructions: test.instructions,
    device: test.device,
    intervalHours: test.intervalHours,
    maxRetries: test.maxRetries,
    notifyOnRecovery: true,
    channelIds: [channelId],
    viewport: { width: 1440, height: 900 },
    modelName: "gpt-5-mini",
    runnerVersion: "zenguy-runner/1.0.0",
  });
}

async function generateSql(encryptionKey) {
  const now = Date.now();
  const periodEnd = now + 10 * 365 * 24 * 60 * 60 * 1_000;
  const ids = {
    owner: "usr_seed_marcos",
    admin: "usr_seed_ana",
    member: "usr_seed_luis",
    workspace: "ws_seed_aguayo",
    ownerMember: "mem_seed_owner",
    adminMember: "mem_seed_admin",
    memberMember: "mem_seed_member",
    subscription: "sub_seed_aguayo",
    secret: "sec_seed_demo",
    channel: "ch_seed_email",
    homepageTest: "bt_seed_homepage",
    checkoutTest: "bt_seed_checkout",
    passedRun: "run_seed_passed",
    failedRun: "run_seed_failed",
    passedAttempt: "att_seed_passed",
    failedAttempt: "att_seed_failed",
    usage: "ue_seed_passed",
    homepageMonitor: "mon_seed_homepage",
    apiMonitor: "mon_seed_api",
    homepageCheck: "chk_seed_homepage",
    apiCheck: "chk_seed_api",
  };
  const homepageTest = {
    name: "Homepage smoke",
    startUrl: "https://example.com",
    instructions:
      "Check that the page shows the heading 'Example Domain' and contains a link labeled 'More information'.",
    device: "DESKTOP",
    intervalHours: 24,
    maxRetries: 1,
  };
  const checkoutTest = {
    name: "Checkout flow",
    startUrl: "https://example.com",
    instructions: "Open the page and confirm the Example Domain heading is still visible.",
    device: "MOBILE",
    intervalHours: 6,
    maxRetries: 0,
  };
  const [
    ownerHash,
    adminHash,
    memberHash,
    encryptedSecret,
    encryptedChannel,
  ] = await Promise.all([
    hashPassword(OWNER_PASSWORD),
    hashPassword(MEMBER_PASSWORD),
    hashPassword(MEMBER_PASSWORD),
    encryptSecret("demo-secret-value", encryptionKey),
    encryptSecret(JSON.stringify({ emails: [OWNER_EMAIL] }), encryptionKey),
  ]);
  const statements = [
    "-- Generated by scripts/seed.mjs. Do not edit or commit.",
    `-- Generated at ${new Date(now).toISOString()}.`,
    "",
    "-- Full wipe of application data. Never targets production from this script.",
    ...WIPE_STATEMENTS,
    "",
    `INSERT INTO users (id, name, email, password_hash, email_verified_at, created_at, updated_at) VALUES (${sqlString(ids.owner)}, 'Marcos Aguayo', ${sqlString(OWNER_EMAIL)}, ${sqlString(ownerHash)}, ${now}, ${now}, ${now});`,
    `INSERT INTO users (id, name, email, password_hash, email_verified_at, created_at, updated_at) VALUES (${sqlString(ids.admin)}, 'Ana Ruiz', ${sqlString(ADMIN_EMAIL)}, ${sqlString(adminHash)}, ${now}, ${now}, ${now});`,
    `INSERT INTO users (id, name, email, password_hash, email_verified_at, created_at, updated_at) VALUES (${sqlString(ids.member)}, 'Luis Ortega', ${sqlString(MEMBER_EMAIL)}, ${sqlString(memberHash)}, ${now}, ${now}, ${now});`,
    `INSERT INTO workspaces (id, name, slug, timezone, owner_user_id, created_at, updated_at, deleted_at) VALUES (${sqlString(ids.workspace)}, 'Aguayo Staging', 'aguayo-staging', 'Europe/Madrid', ${sqlString(ids.owner)}, ${now}, ${now}, NULL);`,
    `INSERT INTO workspace_members (id, workspace_id, user_id, role, invited_by, joined_at) VALUES (${sqlString(ids.ownerMember)}, ${sqlString(ids.workspace)}, ${sqlString(ids.owner)}, 'OWNER', NULL, ${now});`,
    `INSERT INTO workspace_members (id, workspace_id, user_id, role, invited_by, joined_at) VALUES (${sqlString(ids.adminMember)}, ${sqlString(ids.workspace)}, ${sqlString(ids.admin)}, 'ADMIN', ${sqlString(ids.owner)}, ${now});`,
    `INSERT INTO workspace_members (id, workspace_id, user_id, role, invited_by, joined_at) VALUES (${sqlString(ids.memberMember)}, ${sqlString(ids.workspace)}, ${sqlString(ids.member)}, 'MEMBER', ${sqlString(ids.owner)}, ${now});`,
    `INSERT INTO subscriptions (id, workspace_id, provider, source, provider_customer_id, provider_subscription_id, status, period_start, period_end, cancel_at_period_end, update_payment_url, cancel_url, created_at, updated_at) VALUES (${sqlString(ids.subscription)}, ${sqlString(ids.workspace)}, 'paddle', 'grant', NULL, NULL, 'ACTIVE', ${now}, ${periodEnd}, 0, NULL, NULL, ${now}, ${now});`,
    `INSERT INTO workspace_secrets (id, workspace_id, key, encrypted_value, encryption_version, allowed_domains, description, created_by, created_at, updated_at) VALUES (${sqlString(ids.secret)}, ${sqlString(ids.workspace)}, 'DEMO_TOKEN', ${sqlString(encryptedSecret)}, 1, '["*.example.com"]', 'Demo token', ${sqlString(ids.owner)}, ${now}, ${now});`,
    `INSERT INTO notification_channels (id, workspace_id, name, type, encrypted_config, enabled, verified_at, last_delivery_status, created_by, created_at, updated_at) VALUES (${sqlString(ids.channel)}, ${sqlString(ids.workspace)}, 'Staging email', 'EMAIL', ${sqlString(encryptedChannel)}, 1, ${now}, NULL, ${sqlString(ids.owner)}, ${now}, ${now});`,
    `INSERT INTO browser_tests (id, workspace_id, name, start_url, instructions, device, interval_hours, max_retries, notify_on_recovery, next_run_at, created_by, updated_by, created_at, updated_at, deleted_at) VALUES (${sqlString(ids.homepageTest)}, ${sqlString(ids.workspace)}, ${sqlString(homepageTest.name)}, ${sqlString(homepageTest.startUrl)}, ${sqlString(homepageTest.instructions)}, ${sqlString(homepageTest.device)}, ${homepageTest.intervalHours}, ${homepageTest.maxRetries}, 1, ${now + 24 * 60 * 60 * 1_000}, ${sqlString(ids.owner)}, ${sqlString(ids.owner)}, ${now}, ${now}, NULL);`,
    `INSERT INTO browser_tests (id, workspace_id, name, start_url, instructions, device, interval_hours, max_retries, notify_on_recovery, next_run_at, created_by, updated_by, created_at, updated_at, deleted_at) VALUES (${sqlString(ids.checkoutTest)}, ${sqlString(ids.workspace)}, ${sqlString(checkoutTest.name)}, ${sqlString(checkoutTest.startUrl)}, ${sqlString(checkoutTest.instructions)}, ${sqlString(checkoutTest.device)}, ${checkoutTest.intervalHours}, ${checkoutTest.maxRetries}, 1, ${now + 6 * 60 * 60 * 1_000}, ${sqlString(ids.admin)}, ${sqlString(ids.admin)}, ${now}, ${now}, NULL);`,
    `INSERT INTO browser_test_channels (browser_test_id, notification_channel_id) VALUES (${sqlString(ids.homepageTest)}, ${sqlString(ids.channel)});`,
    `INSERT INTO browser_test_channels (browser_test_id, notification_channel_id) VALUES (${sqlString(ids.checkoutTest)}, ${sqlString(ids.channel)});`,
    `INSERT INTO test_runs (id, workspace_id, browser_test_id, source, status, snapshot_json, scheduled_for, queued_at, started_at, finished_at, duration_ms, attempt_count, infra_attempts, passed_after_retry, billable, usage_event_id, triggered_by_user_id, incident_id, created_at) VALUES (${sqlString(ids.passedRun)}, ${sqlString(ids.workspace)}, ${sqlString(ids.homepageTest)}, 'MANUAL', 'PASSED', ${sqlString(runSnapshot(homepageTest, ids.channel))}, NULL, ${now - 120_000}, ${now - 110_000}, ${now - 80_000}, 30000, 1, 0, 0, 1, ${sqlString(ids.usage)}, ${sqlString(ids.owner)}, NULL, ${now - 120_000});`,
    `INSERT INTO test_runs (id, workspace_id, browser_test_id, source, status, snapshot_json, scheduled_for, queued_at, started_at, finished_at, duration_ms, attempt_count, infra_attempts, passed_after_retry, billable, usage_event_id, triggered_by_user_id, incident_id, created_at) VALUES (${sqlString(ids.failedRun)}, ${sqlString(ids.workspace)}, ${sqlString(ids.checkoutTest)}, 'SCHEDULED', 'FAILED', ${sqlString(runSnapshot(checkoutTest, ids.channel))}, ${now - 300_000}, ${now - 300_000}, ${now - 290_000}, ${now - 250_000}, 40000, 1, 0, 0, 1, NULL, NULL, NULL, ${now - 300_000});`,
    `INSERT INTO test_attempts (id, test_run_id, attempt_index, status, retry_delay_seconds, queued_at, started_at, finished_at, duration_ms, summary, expected_result, actual_result, failure_reason, visited_urls_json, created_at) VALUES (${sqlString(ids.passedAttempt)}, ${sqlString(ids.passedRun)}, 0, 'PASSED', 0, ${now - 120_000}, ${now - 110_000}, ${now - 80_000}, 30000, 'Homepage looks healthy.', 'Example Domain heading', 'Example Domain heading', NULL, ${sqlString(JSON.stringify(["https://example.com"]))}, ${now - 120_000});`,
    `INSERT INTO test_attempts (id, test_run_id, attempt_index, status, retry_delay_seconds, queued_at, started_at, finished_at, duration_ms, summary, expected_result, actual_result, failure_reason, visited_urls_json, created_at) VALUES (${sqlString(ids.failedAttempt)}, ${sqlString(ids.failedRun)}, 0, 'FAILED', 0, ${now - 300_000}, ${now - 290_000}, ${now - 250_000}, 40000, 'Checkout heading missing.', 'Example Domain heading', 'Page loaded without the heading', 'The heading was not found', ${sqlString(JSON.stringify(["https://example.com"]))}, ${now - 300_000});`,
    `INSERT INTO usage_events (id, workspace_id, test_run_id, type, quantity, billable, idempotency_key, occurred_at, reversed_at, created_at) VALUES (${sqlString(ids.usage)}, ${sqlString(ids.workspace)}, ${sqlString(ids.passedRun)}, 'BROWSER_RUN', 1, 1, ${sqlString(`run:${ids.passedRun}`)}, ${now - 110_000}, NULL, ${now - 110_000});`,
    `INSERT INTO uptime_monitors (id, workspace_id, name, url, method, encrypted_headers, encrypted_body, expected_status, body_condition, body_expected_value, body_condition_path, frequency_seconds, timeout_seconds, max_retries, notify_on_recovery, next_check_at, current_status, current_cycle_id, cycle_started_at, last_check_at, last_response_time_ms, created_by, created_at, updated_at, deleted_at) VALUES (${sqlString(ids.homepageMonitor)}, ${sqlString(ids.workspace)}, 'Homepage beat', 'https://example.com', 'GET', NULL, NULL, 200, NULL, NULL, NULL, 300, 10, 1, 1, ${now + 300_000}, 'UP', ${sqlString("cyc_seed_homepage")}, ${now - 300_000}, ${now - 30_000}, 120, ${sqlString(ids.owner)}, ${now}, ${now}, NULL);`,
    `INSERT INTO uptime_monitors (id, workspace_id, name, url, method, encrypted_headers, encrypted_body, expected_status, body_condition, body_expected_value, body_condition_path, frequency_seconds, timeout_seconds, max_retries, notify_on_recovery, next_check_at, current_status, current_cycle_id, cycle_started_at, last_check_at, last_response_time_ms, created_by, created_at, updated_at, deleted_at) VALUES (${sqlString(ids.apiMonitor)}, ${sqlString(ids.workspace)}, 'API beat', 'https://example.com/missing', 'GET', NULL, NULL, 200, NULL, NULL, NULL, 600, 10, 1, 1, ${now + 600_000}, 'DOWN', ${sqlString("cyc_seed_api")}, ${now - 600_000}, ${now - 20_000}, 90, ${sqlString(ids.admin)}, ${now}, ${now}, NULL);`,
    `INSERT INTO uptime_monitor_channels (uptime_monitor_id, notification_channel_id) VALUES (${sqlString(ids.homepageMonitor)}, ${sqlString(ids.channel)});`,
    `INSERT INTO uptime_monitor_channels (uptime_monitor_id, notification_channel_id) VALUES (${sqlString(ids.apiMonitor)}, ${sqlString(ids.channel)});`,
    `INSERT INTO uptime_checks (id, workspace_id, uptime_monitor_id, cycle_id, attempt_index, status, http_status, response_time_ms, failure_reason, response_excerpt, checked_at, created_at) VALUES (${sqlString(ids.homepageCheck)}, ${sqlString(ids.workspace)}, ${sqlString(ids.homepageMonitor)}, ${sqlString("cyc_seed_homepage")}, 0, 'PASSED', 200, 120, NULL, NULL, ${now - 30_000}, ${now - 30_000});`,
    `INSERT INTO uptime_checks (id, workspace_id, uptime_monitor_id, cycle_id, attempt_index, status, http_status, response_time_ms, failure_reason, response_excerpt, checked_at, created_at) VALUES (${sqlString(ids.apiCheck)}, ${sqlString(ids.workspace)}, ${sqlString(ids.apiMonitor)}, ${sqlString("cyc_seed_api")}, 0, 'FAILED', 404, 90, 'UNEXPECTED_STATUS', NULL, ${now - 20_000}, ${now - 20_000});`,
    "",
  ];
  return statements.join("\n");
}

function wranglerArguments(remote) {
  return [
    "wrangler",
    "d1",
    "execute",
    remote ? STAGING_DATABASE : LOCAL_DATABASE,
    remote ? "--remote" : "--local",
    ...(remote ? ["--env", STAGING_ENVIRONMENT] : []),
    "--file",
    "scripts/.seed.generated.sql",
  ];
}

async function executeSql(remote) {
  const arguments_ = wranglerArguments(remote);
  await new Promise((resolve, reject) => {
    const child = spawn("npx", arguments_, {
      cwd: API_DIRECTORY,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            signal === null
              ? `Wrangler exited with code ${String(code)}`
              : `Wrangler was terminated by ${signal}`,
          ),
        );
      }
    });
  });
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.printCommand) {
    process.stdout.write(`${JSON.stringify({
      executable: "npx",
      arguments: wranglerArguments(options.remote),
    })}\n`);
    return;
  }
  let varsContents;
  try {
    varsContents = await readFile(options.varsFile, "utf8");
  } catch (error) {
    throw new Error(
      `Cannot read ${options.varsFile}; create apps/api/.dev.vars first`,
      { cause: error },
    );
  }
  const encryptionKeyValue = parseVars(varsContents).get("ENCRYPTION_KEY");
  if (encryptionKeyValue === undefined || encryptionKeyValue === "") {
    throw new Error(`ENCRYPTION_KEY is missing from ${options.varsFile}`);
  }
  const encryptionKey = new Uint8Array(
    Buffer.from(encryptionKeyValue, "base64"),
  );
  if (encryptionKey.byteLength !== 32) {
    throw new Error("ENCRYPTION_KEY must decode to exactly 32 bytes");
  }
  const sql = await generateSql(encryptionKey);
  if (options.dryRun) {
    process.stdout.write(sql);
    return;
  }
  await writeFile(GENERATED_SQL_PATH, sql, "utf8");
  await executeSql(options.remote);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Seed failed: ${message}\n`);
  process.exitCode = 1;
});
