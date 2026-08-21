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
const MEMBER_TWO_EMAIL = "marta@zenguy.dev";
const MEMBER_THREE_EMAIL = "diego@zenguy.dev";
const MEMBER_PASSWORD = "Password123!";
const LOCAL_DATABASE = "zenguy-db";
const STAGING_DATABASE = "zenguy-staging-db";
const STAGING_ENVIRONMENT = "staging";
const RUNNER_VERSION = "zenguy-runner/1.0.0";
const MODEL_NAME = "gpt-5-mini";
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const SEED_TEST_PARKED_UNTIL_MS = Date.parse("2030-01-01T00:00:00Z");
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

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
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

async function sha256Hex(value) {
  const digest = await webcrypto.subtle.digest(
    "SHA-256",
    encoder.encode(value),
  );
  return bytesToHex(new Uint8Array(digest));
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  return sqlString(value);
}

function insertRow(table, row) {
  const columns = Object.keys(row);
  return `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns
    .map((column) => sqlValue(row[column]))
    .join(", ")});`;
}

function insertMany(table, rows, chunkSize = 40) {
  if (rows.length === 0) return [];
  const columns = Object.keys(rows[0]);
  const statements = [];
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    const values = chunk
      .map(
        (row) =>
          `(${columns.map((column) => sqlValue(row[column])).join(", ")})`,
      )
      .join(",\n  ");
    statements.push(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES\n  ${values};`,
    );
  }
  return statements;
}

function pad(value, size = 4) {
  return String(value).padStart(size, "0");
}

function vary(seed, base, spread) {
  let hash = 0;
  const text = String(seed);
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return base + (hash % spread);
}

function runSnapshot(test, channelIds) {
  return JSON.stringify({
    name: test.name,
    startUrl: test.startUrl,
    instructions: test.instructions,
    device: test.device,
    intervalHours: test.intervalHours,
    maxRetries: test.maxRetries,
    notifyOnRecovery: true,
    channelIds,
    viewport:
      test.device === "MOBILE"
        ? { width: 390, height: 844 }
        : { width: 1440, height: 900 },
    modelName: MODEL_NAME,
    runnerVersion: RUNNER_VERSION,
  });
}

function monthStartUtc(now) {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
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

const IDS = {
  owner: "usr_seed_marcos",
  admin: "usr_seed_ana",
  member: "usr_seed_luis",
  memberTwo: "usr_seed_marta",
  memberThree: "usr_seed_diego",
  workspace: "ws_seed_aguayo",
  ownerMember: "mem_seed_owner",
  adminMember: "mem_seed_admin",
  memberMember: "mem_seed_member",
  memberTwoMember: "mem_seed_marta",
  memberThreeMember: "mem_seed_diego",
  subscription: "sub_seed_aguayo",
};

function browserTests() {
  return [
    {
      slug: "homepage",
      name: "Homepage smoke",
      startUrl: "https://example.com",
      instructions:
        "Check that the page shows the heading 'Example Domain' and contains a link labeled 'More information'.",
      device: "DESKTOP",
      intervalHours: 24,
      maxRetries: 1,
      createdBy: IDS.owner,
      actor: "owner",
    },
    {
      slug: "checkout",
      name: "Checkout flow",
      startUrl: "https://shop.example.com/checkout",
      instructions:
        "Open checkout, confirm the order summary is visible, and that the pay button stays enabled.",
      device: "MOBILE",
      intervalHours: 6,
      maxRetries: 0,
      createdBy: IDS.admin,
      actor: "admin",
    },
    {
      slug: "login",
      name: "Login form",
      startUrl: "https://shop.example.com/login",
      instructions:
        "Sign in with {{CHECKOUT_USER}} / {{CHECKOUT_PASSWORD}} and confirm the account menu is visible.",
      device: "DESKTOP",
      intervalHours: 8,
      maxRetries: 1,
      createdBy: IDS.owner,
      actor: "owner",
    },
    {
      slug: "search",
      name: "Product search",
      startUrl: "https://shop.example.com/search?q=linen",
      instructions:
        "Search for linen shirts, open the first result, and confirm the product title and price render.",
      device: "DESKTOP",
      intervalHours: 12,
      maxRetries: 1,
      createdBy: IDS.admin,
      actor: "admin",
    },
    {
      slug: "cart",
      name: "Add to cart",
      startUrl: "https://shop.example.com/products/linen-shirt",
      instructions:
        "Choose size M, add the item to the cart, and confirm the cart count updates to 1.",
      device: "DESKTOP",
      intervalHours: 6,
      maxRetries: 1,
      createdBy: IDS.owner,
      actor: "owner",
    },
    {
      slug: "pricing",
      name: "Pricing page",
      startUrl: "https://example.com/pricing",
      instructions:
        "Open the pricing page and confirm the monthly plan shows EUR 39 and an extra-run price of EUR 0.20.",
      device: "DESKTOP",
      intervalHours: 24,
      maxRetries: 2,
      createdBy: IDS.admin,
      actor: "admin",
    },
    {
      slug: "signup",
      name: "Signup flow",
      startUrl: "https://shop.example.com/signup",
      instructions:
        "Fill the signup form with a disposable address and confirm the verification-pending screen appears.",
      device: "DESKTOP",
      intervalHours: 12,
      maxRetries: 1,
      createdBy: IDS.member,
      actor: "member",
    },
    {
      slug: "settings",
      name: "Account settings",
      startUrl: "https://shop.example.com/account/settings",
      instructions:
        "Open account settings and confirm name, email, and timezone fields are populated.",
      device: "DESKTOP",
      intervalHours: 24,
      maxRetries: 0,
      createdBy: IDS.admin,
      actor: "admin",
    },
    {
      slug: "reset",
      name: "Password reset",
      startUrl: "https://shop.example.com/forgot-password",
      instructions:
        "Submit the forgot-password form and confirm the check-your-email confirmation is shown.",
      device: "MOBILE",
      intervalHours: 24,
      maxRetries: 1,
      createdBy: IDS.owner,
      actor: "owner",
    },
    {
      slug: "nav",
      name: "Mobile navigation",
      startUrl: "https://shop.example.com",
      instructions:
        "Open the mobile menu, visit Collections, and confirm the grid of products loads.",
      device: "MOBILE",
      intervalHours: 8,
      maxRetries: 0,
      createdBy: IDS.memberTwo,
      actor: "memberTwo",
    },
    {
      slug: "contact",
      name: "Contact form",
      startUrl: "https://example.com/contact",
      instructions:
        "Fill the contact form with a sample message and confirm the thank-you state appears.",
      device: "DESKTOP",
      intervalHours: 24,
      maxRetries: 1,
      createdBy: IDS.admin,
      actor: "admin",
    },
    {
      slug: "blog",
      name: "Blog listing",
      startUrl: "https://example.com/blog",
      instructions:
        "Open the blog index, click the latest post, and confirm the article heading and publish date.",
      device: "DESKTOP",
      intervalHours: 12,
      maxRetries: 0,
      createdBy: IDS.owner,
      actor: "owner",
    },
  ];
}

function uptimeMonitors() {
  return [
    {
      slug: "homepage",
      name: "Homepage beat",
      url: "https://example.com",
      method: "GET",
      frequencySeconds: 300,
      expectedStatus: 200,
      bodyCondition: null,
      bodyExpectedValue: null,
      bodyConditionPath: null,
      currentStatus: "UP",
      createdBy: IDS.owner,
      headers: null,
      body: null,
      outages: [],
    },
    {
      slug: "api",
      name: "API beat",
      url: "https://api.example.com/health",
      method: "GET",
      frequencySeconds: 600,
      expectedStatus: 200,
      bodyCondition: "CONTAINS",
      bodyExpectedValue: "ok",
      bodyConditionPath: null,
      currentStatus: "DOWN",
      createdBy: IDS.admin,
      headers: null,
      body: null,
      outages: [{ fromHoursAgo: 8, toHoursAgo: 0 }],
    },
    {
      slug: "auth",
      name: "Auth service",
      url: "https://api.example.com/auth/health",
      method: "GET",
      frequencySeconds: 300,
      expectedStatus: 200,
      bodyCondition: "CONTAINS",
      bodyExpectedValue: '"status":"up"',
      bodyConditionPath: null,
      currentStatus: "UP",
      createdBy: IDS.owner,
      headers: null,
      body: null,
      outages: [],
    },
    {
      slug: "checkout_api",
      name: "Checkout API",
      url: "https://api.example.com/checkout/health",
      method: "POST",
      frequencySeconds: 300,
      expectedStatus: 200,
      bodyCondition: "JSON_PATH_EQUALS",
      bodyExpectedValue: "ready",
      bodyConditionPath: "$.status",
      currentStatus: "UP",
      createdBy: IDS.admin,
      headers: [{ key: "Authorization", value: "Bearer {{DEMO_TOKEN}}" }],
      body: '{"probe":true}',
      outages: [{ fromHoursAgo: 4.7, toHoursAgo: 4 }],
    },
    {
      slug: "cdn",
      name: "CDN origin",
      url: "https://cdn.example.com/health",
      method: "HEAD",
      frequencySeconds: 600,
      expectedStatus: 200,
      bodyCondition: null,
      bodyExpectedValue: null,
      bodyConditionPath: null,
      currentStatus: "UP",
      createdBy: IDS.owner,
      headers: null,
      body: null,
      outages: [],
    },
    {
      slug: "status",
      name: "Status page",
      url: "https://status.example.com",
      method: "GET",
      frequencySeconds: 900,
      expectedStatus: 200,
      bodyCondition: "NOT_CONTAINS",
      bodyExpectedValue: "Major outage",
      bodyConditionPath: null,
      currentStatus: "UP",
      createdBy: IDS.admin,
      headers: null,
      body: null,
      outages: [],
    },
    {
      slug: "docs",
      name: "Docs site",
      url: "https://docs.example.com",
      method: "GET",
      frequencySeconds: 1800,
      expectedStatus: 200,
      bodyCondition: null,
      bodyExpectedValue: null,
      bodyConditionPath: null,
      currentStatus: "UP",
      createdBy: IDS.member,
      headers: null,
      body: null,
      outages: [],
    },
    {
      slug: "assets",
      name: "Assets CDN",
      url: "https://assets.example.com/ping",
      method: "GET",
      frequencySeconds: 3600,
      expectedStatus: 200,
      bodyCondition: null,
      bodyExpectedValue: null,
      bodyConditionPath: null,
      currentStatus: "UP",
      createdBy: IDS.owner,
      headers: null,
      body: null,
      outages: [],
    },
    {
      slug: "webhooks",
      name: "Webhooks receiver",
      url: "https://api.example.com/webhooks/health",
      method: "GET",
      frequencySeconds: 300,
      expectedStatus: 200,
      bodyCondition: "EQUALS",
      bodyExpectedValue: "ready",
      bodyConditionPath: null,
      currentStatus: "DOWN",
      createdBy: IDS.admin,
      headers: null,
      body: null,
      outages: [{ fromHoursAgo: 2, toHoursAgo: 0 }],
    },
    {
      slug: "billing",
      name: "Billing API",
      url: "https://api.example.com/billing/health",
      method: "GET",
      frequencySeconds: 600,
      expectedStatus: 200,
      bodyCondition: null,
      bodyExpectedValue: null,
      bodyConditionPath: null,
      currentStatus: "UNKNOWN",
      createdBy: IDS.owner,
      headers: null,
      body: null,
      outages: [],
      skipHistory: true,
    },
  ];
}

function specialRunStatus(slug, newestIndex, runIndex) {
  if (slug === "checkout" && newestIndex <= 2) return "FAILED";
  if (slug === "cart" && newestIndex === 0) return "TIMEOUT";
  if (slug === "signup" && newestIndex === 0) return "SYSTEM_ERROR";
  if (slug === "login" && newestIndex === 1) return "FAILED";
  if (slug === "search" && newestIndex === 2) return "FAILED";
  if (slug === "pricing" && newestIndex === 3) return "FAILED";
  if (slug === "homepage" && newestIndex === 5) return "FAILED";
  if (runIndex % 11 === 7 && newestIndex > 4) return "FAILED";
  return "PASSED";
}

function attemptPayload(status, test) {
  if (status === "PASSED") {
    return {
      summary: `${test.name} looks healthy.`,
      expected: "Expected heading and primary action are visible",
      actual: "Expected heading and primary action are visible",
      failure: null,
      consoleErrors: null,
      networkErrors: null,
      systemErrorCode: null,
    };
  }
  if (status === "TIMEOUT") {
    return {
      summary: `${test.name} timed out waiting for the page.`,
      expected: "Page becomes interactive within 30s",
      actual: "Spinner was still visible at timeout",
      failure: "Timed out waiting for the primary action",
      consoleErrors: JSON.stringify([
        {
          level: "error",
          message: "ChunkLoadError: Loading chunk 17 failed",
          url: `${test.startUrl.replace(/\/$/u, "")}/assets/app.js`,
          timestamp: new Date().toISOString(),
        },
      ]),
      networkErrors: JSON.stringify([
        {
          method: "GET",
          host: new URL(test.startUrl).host,
          path: "/assets/app.js",
          statusCode: null,
          errorType: "timeout",
          durationMs: 30_000,
        },
      ]),
      systemErrorCode: null,
    };
  }
  if (status === "SYSTEM_ERROR") {
    return {
      summary: "Runner lost the browser session.",
      expected: "Browser session stays alive",
      actual: "Browser closed before the first action",
      failure: "Browser session terminated",
      consoleErrors: null,
      networkErrors: null,
      systemErrorCode: "BROWSER_DISCONNECTED",
    };
  }
  return {
    summary: `${test.name} did not match the expected result.`,
    expected: "Expected heading is visible",
    actual: "Page loaded without the heading",
    failure: "The heading was not found",
    consoleErrors: JSON.stringify([
      {
        level: "error",
        message: "Uncaught TypeError: Cannot read properties of null",
        url: test.startUrl,
        timestamp: new Date().toISOString(),
      },
    ]),
    networkErrors: JSON.stringify([
      {
        method: "GET",
        host: new URL(test.startUrl).host,
        path: new URL(test.startUrl).pathname,
        statusCode: 500,
        errorType: "http_error",
        durationMs: 890,
      },
    ]),
    systemErrorCode: null,
  };
}

function stepsForAttempt(attemptId, test, status, startedAt) {
  const url = test.startUrl;
  const steps = [
    {
      actionType: "navigate",
      description: `Open ${url}`,
      urlSanitized: url,
      result: "OK",
    },
    {
      actionType: "wait",
      description: "Wait for the document to become idle",
      urlSanitized: url,
      result: "OK",
    },
    {
      actionType: "click",
      description:
        status === "PASSED"
          ? "Click the primary call to action"
          : "Click the primary call to action",
      urlSanitized: url,
      result: status === "TIMEOUT" || status === "SYSTEM_ERROR" ? "ERROR" : "OK",
    },
  ];
  if (status === "PASSED") {
    steps.push(
      {
        actionType: "scroll",
        description: "Scroll to the main content",
        urlSanitized: url,
        result: "OK",
      },
      {
        actionType: "finish",
        description: "Confirm the expected heading and action are visible",
        urlSanitized: url,
        result: "OK",
      },
    );
  } else if (status === "FAILED") {
    steps.push({
      actionType: "finish",
      description: "The expected heading was missing",
      urlSanitized: url,
      result: "ERROR",
    });
  } else {
    steps.push({
      actionType: "finish",
      description:
        status === "TIMEOUT"
          ? "Timed out waiting for the page"
          : "Browser session ended",
      urlSanitized: url,
      result: "ERROR",
    });
  }
  return steps.map((step, sequence) => ({
    id: `step_${attemptId}_${sequence}`,
    attempt_id: attemptId,
    sequence,
    timestamp: startedAt + (sequence + 1) * 1_800,
    action_type: step.actionType,
    description: step.description,
    url_sanitized: step.urlSanitized,
    result: step.result,
    artifact_id: null,
    created_at: startedAt + (sequence + 1) * 1_800,
  }));
}

async function generateSql(encryptionKey) {
  const now = Date.now();
  const workspaceCreated = now - 40 * DAY_MS;
  const periodStart = monthStartUtc(now);
  const periodEnd = now + 10 * 365 * DAY_MS;
  const tests = browserTests();
  const monitors = uptimeMonitors();
  const channelIds = {
    email: "ch_seed_email",
    sms: "ch_seed_sms",
    slack: "ch_seed_slack",
    discord: "ch_seed_discord",
    whatsapp: "ch_seed_whatsapp",
    call: "ch_seed_call",
  };
  const defaultChannelIds = [channelIds.email, channelIds.slack];
  const allAlertChannelIds = [
    channelIds.email,
    channelIds.sms,
    channelIds.slack,
    channelIds.discord,
    channelIds.whatsapp,
  ];

  const [
    ownerHash,
    adminHash,
    memberHash,
    memberTwoHash,
    memberThreeHash,
    encryptedDemo,
    encryptedUser,
    encryptedPassword,
    encryptedStripe,
    encryptedCookie,
    encryptedOtp,
    encryptedEmail,
    encryptedSms,
    encryptedSlack,
    encryptedDiscord,
    encryptedWhatsapp,
    encryptedCall,
    encryptedCheckoutHeaders,
    encryptedCheckoutBody,
    pendingInviteHash,
    designerInviteHash,
    revokedInviteHash,
    apiKeyHash,
    revokedKeyHash,
  ] = await Promise.all([
    hashPassword(OWNER_PASSWORD),
    hashPassword(MEMBER_PASSWORD),
    hashPassword(MEMBER_PASSWORD),
    hashPassword(MEMBER_PASSWORD),
    hashPassword(MEMBER_PASSWORD),
    encryptSecret("seed-demo-token", encryptionKey),
    encryptSecret("checkout.demo@example.com", encryptionKey),
    encryptSecret("seed-checkout-password", encryptionKey),
    encryptSecret("sk_test_seed_stripe_key", encryptionKey),
    encryptSecret("seed-session-cookie", encryptionKey),
    encryptSecret("seed-admin-otp", encryptionKey),
    encryptSecret(
      JSON.stringify({ emails: [OWNER_EMAIL, ADMIN_EMAIL] }),
      encryptionKey,
    ),
    encryptSecret(JSON.stringify({ phoneNumber: "+34600111222" }), encryptionKey),
    encryptSecret(
      JSON.stringify({
        webhookUrl: "https://hooks.slack.com/services/T000/B000/SEED",
      }),
      encryptionKey,
    ),
    encryptSecret(
      JSON.stringify({
        webhookUrl:
          "https://discord.com/api/webhooks/123456789012345678/seedtoken",
      }),
      encryptionKey,
    ),
    encryptSecret(JSON.stringify({ phoneNumber: "+34600999888" }), encryptionKey),
    encryptSecret(JSON.stringify({ phoneNumber: "+34600111000" }), encryptionKey),
    encryptSecret(
      JSON.stringify([{ key: "Authorization", value: "Bearer {{DEMO_TOKEN}}" }]),
      encryptionKey,
    ),
    encryptSecret('{"probe":true}', encryptionKey),
    sha256Hex("seed-invite-pending-noelia"),
    sha256Hex("seed-invite-pending-sofia"),
    sha256Hex("seed-invite-revoked-intern"),
    sha256Hex("zgk_seedstatusdashboard00000000000001"),
    sha256Hex("zgk_seedrevokedlegacykey0000000000002"),
  ]);

  const statements = [
    "-- Generated by scripts/seed.mjs. Do not edit or commit.",
    `-- Generated at ${new Date(now).toISOString()}.`,
    "",
    "-- Full wipe of application data. Never targets production from this script.",
    ...WIPE_STATEMENTS,
    "",
    insertRow("users", {
      id: IDS.owner,
      name: "Marcos Aguayo",
      email: OWNER_EMAIL,
      password_hash: ownerHash,
      email_verified_at: workspaceCreated,
      created_at: workspaceCreated,
      updated_at: now,
    }),
    insertRow("users", {
      id: IDS.admin,
      name: "Ana Ruiz",
      email: ADMIN_EMAIL,
      password_hash: adminHash,
      email_verified_at: workspaceCreated + DAY_MS,
      created_at: workspaceCreated + DAY_MS,
      updated_at: now,
    }),
    insertRow("users", {
      id: IDS.member,
      name: "Luis Ortega",
      email: MEMBER_EMAIL,
      password_hash: memberHash,
      email_verified_at: workspaceCreated + 8 * DAY_MS,
      created_at: workspaceCreated + 8 * DAY_MS,
      updated_at: now,
    }),
    insertRow("users", {
      id: IDS.memberTwo,
      name: "Marta Vega",
      email: MEMBER_TWO_EMAIL,
      password_hash: memberTwoHash,
      email_verified_at: workspaceCreated + 18 * DAY_MS,
      created_at: workspaceCreated + 18 * DAY_MS,
      updated_at: now,
    }),
    insertRow("users", {
      id: IDS.memberThree,
      name: "Diego Santos",
      email: MEMBER_THREE_EMAIL,
      password_hash: memberThreeHash,
      email_verified_at: workspaceCreated + 28 * DAY_MS,
      created_at: workspaceCreated + 28 * DAY_MS,
      updated_at: now,
    }),
    insertRow("workspaces", {
      id: IDS.workspace,
      name: "Aguayo Staging",
      slug: "aguayo-staging",
      timezone: "Europe/Madrid",
      owner_user_id: IDS.owner,
      created_at: workspaceCreated,
      updated_at: now,
      deleted_at: null,
    }),
    insertRow("workspace_members", {
      id: IDS.ownerMember,
      workspace_id: IDS.workspace,
      user_id: IDS.owner,
      role: "OWNER",
      invited_by: null,
      joined_at: workspaceCreated,
    }),
    insertRow("workspace_members", {
      id: IDS.adminMember,
      workspace_id: IDS.workspace,
      user_id: IDS.admin,
      role: "ADMIN",
      invited_by: IDS.owner,
      joined_at: workspaceCreated + 2 * DAY_MS,
    }),
    insertRow("workspace_members", {
      id: IDS.memberMember,
      workspace_id: IDS.workspace,
      user_id: IDS.member,
      role: "MEMBER",
      invited_by: IDS.owner,
      joined_at: workspaceCreated + 10 * DAY_MS,
    }),
    insertRow("workspace_members", {
      id: IDS.memberTwoMember,
      workspace_id: IDS.workspace,
      user_id: IDS.memberTwo,
      role: "MEMBER",
      invited_by: IDS.admin,
      joined_at: workspaceCreated + 20 * DAY_MS,
    }),
    insertRow("workspace_members", {
      id: IDS.memberThreeMember,
      workspace_id: IDS.workspace,
      user_id: IDS.memberThree,
      role: "MEMBER",
      invited_by: IDS.admin,
      joined_at: workspaceCreated + 30 * DAY_MS,
    }),
    insertRow("subscriptions", {
      id: IDS.subscription,
      workspace_id: IDS.workspace,
      provider: "paddle",
      source: "grant",
      provider_customer_id: null,
      provider_subscription_id: null,
      status: "ACTIVE",
      period_start: periodStart,
      period_end: periodEnd,
      cancel_at_period_end: 0,
      update_payment_url: null,
      cancel_url: null,
      created_at: workspaceCreated,
      updated_at: now,
    }),
    insertRow("workspace_invitations", {
      id: "inv_seed_noelia",
      workspace_id: IDS.workspace,
      email: "noelia@zenguy.dev",
      role: "ADMIN",
      token_hash: pendingInviteHash,
      invited_by: IDS.owner,
      expires_at: now + 5 * DAY_MS,
      accepted_at: null,
      revoked_at: null,
      created_at: now - 2 * DAY_MS,
    }),
    insertRow("workspace_invitations", {
      id: "inv_seed_sofia",
      workspace_id: IDS.workspace,
      email: "sofia@zenguy.dev",
      role: "MEMBER",
      token_hash: designerInviteHash,
      invited_by: IDS.admin,
      expires_at: now + 6 * DAY_MS,
      accepted_at: null,
      revoked_at: null,
      created_at: now - 12 * HOUR_MS,
    }),
    insertRow("workspace_invitations", {
      id: "inv_seed_intern",
      workspace_id: IDS.workspace,
      email: "intern@zenguy.dev",
      role: "MEMBER",
      token_hash: revokedInviteHash,
      invited_by: IDS.owner,
      expires_at: now + DAY_MS,
      accepted_at: null,
      revoked_at: now - 3 * DAY_MS,
      created_at: now - 6 * DAY_MS,
    }),
    insertRow("workspace_api_keys", {
      id: "ak_seed_status",
      workspace_id: IDS.workspace,
      name: "Status dashboard",
      key_prefix: "zgk_seedstat",
      key_hash: apiKeyHash,
      created_by: IDS.owner,
      created_at: now - 12 * DAY_MS,
      last_used_at: now - 18 * MINUTE_MS,
      revoked_at: null,
    }),
    insertRow("workspace_api_keys", {
      id: "ak_seed_legacy",
      workspace_id: IDS.workspace,
      name: "Legacy CLI",
      key_prefix: "zgk_seedrevo",
      key_hash: revokedKeyHash,
      created_by: IDS.admin,
      created_at: now - 28 * DAY_MS,
      last_used_at: now - 20 * DAY_MS,
      revoked_at: now - 14 * DAY_MS,
    }),
  ];

  const secrets = [
    {
      id: "sec_seed_demo",
      key: "DEMO_TOKEN",
      value: encryptedDemo,
      domains: '["*.example.com"]',
      description: "Demo API token for authenticated probes",
      createdBy: IDS.owner,
      createdAt: workspaceCreated + DAY_MS,
    },
    {
      id: "sec_seed_checkout_user",
      key: "CHECKOUT_USER",
      value: encryptedUser,
      domains: '["shop.example.com"]',
      description: "Checkout demo username",
      createdBy: IDS.admin,
      createdAt: workspaceCreated + 3 * DAY_MS,
    },
    {
      id: "sec_seed_checkout_password",
      key: "CHECKOUT_PASSWORD",
      value: encryptedPassword,
      domains: '["shop.example.com"]',
      description: "Checkout demo password",
      createdBy: IDS.admin,
      createdAt: workspaceCreated + 3 * DAY_MS,
    },
    {
      id: "sec_seed_stripe",
      key: "STRIPE_TEST_KEY",
      value: encryptedStripe,
      domains: '["api.example.com","shop.example.com"]',
      description: "Stripe test key",
      createdBy: IDS.owner,
      createdAt: workspaceCreated + 5 * DAY_MS,
    },
    {
      id: "sec_seed_session",
      key: "SESSION_COOKIE",
      value: encryptedCookie,
      domains: '["shop.example.com"]',
      description: "Staging session cookie",
      createdBy: IDS.owner,
      createdAt: workspaceCreated + 7 * DAY_MS,
    },
    {
      id: "sec_seed_otp",
      key: "ADMIN_OTP",
      value: encryptedOtp,
      domains: '["shop.example.com"]',
      description: "Admin OTP for settings tests",
      createdBy: IDS.admin,
      createdAt: workspaceCreated + 9 * DAY_MS,
    },
  ];
  for (const secret of secrets) {
    statements.push(
      insertRow("workspace_secrets", {
        id: secret.id,
        workspace_id: IDS.workspace,
        key: secret.key,
        encrypted_value: secret.value,
        encryption_version: 1,
        allowed_domains: secret.domains,
        description: secret.description,
        created_by: secret.createdBy,
        created_at: secret.createdAt,
        updated_at: secret.createdAt,
      }),
    );
  }

  const channels = [
    {
      id: channelIds.email,
      name: "Staging email",
      type: "EMAIL",
      config: encryptedEmail,
      enabled: 1,
      verifiedAt: workspaceCreated + 2 * DAY_MS,
      lastDeliveryStatus: "SENT",
      createdBy: IDS.owner,
    },
    {
      id: channelIds.sms,
      name: "On-call SMS",
      type: "SMS",
      config: encryptedSms,
      enabled: 1,
      verifiedAt: workspaceCreated + 4 * DAY_MS,
      lastDeliveryStatus: "SENT",
      createdBy: IDS.admin,
    },
    {
      id: channelIds.slack,
      name: "Slack #incidents",
      type: "SLACK",
      config: encryptedSlack,
      enabled: 1,
      verifiedAt: workspaceCreated + 5 * DAY_MS,
      lastDeliveryStatus: "FAILED",
      createdBy: IDS.owner,
    },
    {
      id: channelIds.discord,
      name: "Discord ops",
      type: "DISCORD",
      config: encryptedDiscord,
      enabled: 1,
      verifiedAt: workspaceCreated + 6 * DAY_MS,
      lastDeliveryStatus: "SENT",
      createdBy: IDS.admin,
    },
    {
      id: channelIds.whatsapp,
      name: "WhatsApp on-call",
      type: "WHATSAPP",
      config: encryptedWhatsapp,
      enabled: 1,
      verifiedAt: workspaceCreated + 8 * DAY_MS,
      lastDeliveryStatus: "SENT",
      createdBy: IDS.owner,
    },
    {
      id: channelIds.call,
      name: "Night pager",
      type: "CALL",
      config: encryptedCall,
      enabled: 0,
      verifiedAt: null,
      lastDeliveryStatus: null,
      createdBy: IDS.admin,
    },
  ];
  for (const [index, channel] of channels.entries()) {
    statements.push(
      insertRow("notification_channels", {
        id: channel.id,
        workspace_id: IDS.workspace,
        name: channel.name,
        type: channel.type,
        encrypted_config: channel.config,
        enabled: channel.enabled,
        verified_at: channel.verifiedAt,
        last_delivery_status: channel.lastDeliveryStatus,
        created_by: channel.createdBy,
        created_at: workspaceCreated + (index + 2) * DAY_MS,
        updated_at: now - 3 * HOUR_MS,
      }),
    );
  }

  const testRows = [];
  const testChannelRows = [];
  for (const [index, test] of tests.entries()) {
    const id = `bt_seed_${test.slug}`;
    const createdAt = workspaceCreated + (index + 3) * DAY_MS;
    testRows.push({
      id,
      workspace_id: IDS.workspace,
      name: test.name,
      start_url: test.startUrl,
      instructions: test.instructions,
      device: test.device,
      interval_hours: test.intervalHours,
      max_retries: test.maxRetries,
      notify_on_recovery: 1,
      // Parked far in the future: staging runs an always-on fallback runner
      // that would otherwise execute every seeded demo test (mostly against
      // fake domains) as soon as it came due. Bump next_run_at manually when
      // a real staging execution is wanted.
      next_run_at: SEED_TEST_PARKED_UNTIL_MS,
      created_by: test.createdBy,
      updated_by: test.createdBy,
      created_at: createdAt,
      updated_at: now - index * HOUR_MS,
      deleted_at: null,
    });
    const linked =
      test.slug === "checkout" || test.slug === "cart"
        ? allAlertChannelIds
        : defaultChannelIds;
    for (const channelId of linked) {
      testChannelRows.push({
        browser_test_id: id,
        notification_channel_id: channelId,
      });
    }
  }
  statements.push(...insertMany("browser_tests", testRows, 12));
  statements.push(...insertMany("browser_test_channels", testChannelRows, 20));

  const runRows = [];
  const attemptRows = [];
  const stepRows = [];
  const usageRows = [];
  const testLatest = new Map();

  for (const test of tests) {
    const testId = `bt_seed_${test.slug}`;
    const intervalMs = test.intervalHours * HOUR_MS;
    const history = Math.min(
      18,
      Math.max(10, Math.floor((14 * 24) / test.intervalHours)),
    );
    const channelIdsForTest =
      test.slug === "checkout" || test.slug === "cart"
        ? allAlertChannelIds
        : defaultChannelIds;
    for (let newestIndex = history - 1; newestIndex >= 0; newestIndex -= 1) {
      const runIndex = history - 1 - newestIndex;
      const finishedAt = now - newestIndex * intervalMs - vary(test.slug, 40_000, 90_000);
      const durationMs = vary(`${test.slug}-${newestIndex}`, 12_000, 28_000);
      const startedAt = finishedAt - durationMs;
      const queuedAt = startedAt - vary(runIndex, 1_000, 8_000);
      const status = specialRunStatus(test.slug, newestIndex, runIndex);
      const source =
        newestIndex === 0 && (test.slug === "homepage" || test.slug === "pricing")
          ? "MANUAL"
          : "SCHEDULED";
      const retry =
        test.slug === "pricing" && newestIndex === 0 && status === "PASSED";
      const billable = status !== "SYSTEM_ERROR";
      const runId = `run_seed_${test.slug}_${pad(runIndex)}`;
      const usageId = billable ? `ue_seed_${test.slug}_${pad(runIndex)}` : null;
      const scheduledFor = source === "SCHEDULED" ? queuedAt : null;
      const passedAfterRetry = retry ? 1 : 0;
      const attemptCount = retry ? 2 : 1;
      runRows.push({
        id: runId,
        workspace_id: IDS.workspace,
        browser_test_id: testId,
        source,
        status,
        snapshot_json: runSnapshot(test, channelIdsForTest),
        scheduled_for: scheduledFor,
        queued_at: queuedAt,
        started_at: startedAt,
        finished_at: finishedAt,
        duration_ms: durationMs,
        attempt_count: attemptCount,
        infra_attempts: status === "SYSTEM_ERROR" ? 2 : 0,
        passed_after_retry: passedAfterRetry,
        billable: billable ? 1 : 0,
        usage_event_id: usageId,
        triggered_by_user_id: source === "MANUAL" ? IDS.owner : null,
        incident_id: null,
        created_at: queuedAt,
      });
      if (newestIndex === 0) {
        testLatest.set(test.slug, {
          runId,
          status,
          finishedAt,
          queuedAt,
        });
      }

      const attempts = retry
        ? [
            { index: 0, status: "FAILED", delay: 0, offset: 0 },
            { index: 1, status: "PASSED", delay: 60, offset: 70_000 },
          ]
        : [{ index: 0, status, delay: 0, offset: 0 }];
      for (const attempt of attempts) {
        const attemptId = `att_seed_${test.slug}_${pad(runIndex)}_${attempt.index}`;
        const attemptQueued = queuedAt + attempt.offset;
        const attemptStarted = startedAt + attempt.offset;
        const attemptFinished =
          attempt.status === "PASSED" || attempt.index === attempts.length - 1
            ? finishedAt
            : attemptStarted + 18_000;
        const payload = attemptPayload(attempt.status, test);
        attemptRows.push({
          id: attemptId,
          test_run_id: runId,
          attempt_index: attempt.index,
          status: attempt.status,
          retry_delay_seconds: attempt.delay,
          queued_at: attemptQueued,
          started_at: attemptStarted,
          finished_at: attemptFinished,
          duration_ms: attemptFinished - attemptStarted,
          summary: payload.summary,
          expected_result: payload.expected,
          actual_result: payload.actual,
          failure_reason: payload.failure,
          visited_urls_json: JSON.stringify([test.startUrl]),
          console_errors_json: payload.consoleErrors,
          network_errors_json: payload.networkErrors,
          token_usage: vary(attemptId, 1_400, 6_000),
          model_name: MODEL_NAME,
          runner_version: RUNNER_VERSION,
          system_error_code: payload.systemErrorCode,
          created_at: attemptQueued,
        });
        if (newestIndex <= 1) {
          stepRows.push(
            ...stepsForAttempt(attemptId, test, attempt.status, attemptStarted),
          );
        }
      }
      if (billable && usageId !== null && finishedAt >= periodStart) {
        usageRows.push({
          id: usageId,
          workspace_id: IDS.workspace,
          test_run_id: runId,
          type: "BROWSER_RUN",
          quantity: 1,
          billable: 1,
          idempotency_key: `run:${runId}`,
          occurred_at: startedAt,
          reversed_at: null,
          created_at: startedAt,
        });
      }
    }
  }

  const monitorRows = [];
  const monitorChannelRows = [];
  const checkRows = [];
  const monitorMeta = new Map();
  for (const [index, monitor] of monitors.entries()) {
    const id = `mon_seed_${monitor.slug}`;
    const createdAt =
      monitor.slug === "billing" ? now - 2 * HOUR_MS : workspaceCreated + (index + 4) * DAY_MS;
    const lastCheckAt = monitor.skipHistory ? null : now - 45_000 - index * 4_000;
    const checks = [];
    if (!monitor.skipHistory) {
      const windowMs = 24 * HOUR_MS;
      const firstAt =
        lastCheckAt -
        Math.floor(windowMs / (monitor.frequencySeconds * 1_000)) *
          monitor.frequencySeconds *
          1_000;
      let sequence = 0;
      for (
        let checkedAt = firstAt;
        checkedAt <= lastCheckAt;
        checkedAt += monitor.frequencySeconds * 1_000
      ) {
        const hoursAgo = (now - checkedAt) / HOUR_MS;
        const down = monitor.outages.some(
          (outage) => hoursAgo <= outage.fromHoursAgo && hoursAgo >= outage.toHoursAgo,
        );
        const cycleId = `cyc_seed_${monitor.slug}_${pad(sequence)}`;
        const checkId = `chk_seed_${monitor.slug}_${pad(sequence)}`;
        const responseTime = down
          ? vary(checkId, 800, 1_400)
          : vary(checkId, 90, 160);
        checks.push({
          id: checkId,
          workspace_id: IDS.workspace,
          uptime_monitor_id: id,
          cycle_id: cycleId,
          attempt_index: 0,
          status: down ? "FAILED" : "PASSED",
          http_status: down ? 503 : monitor.expectedStatus,
          response_time_ms: responseTime,
          failure_reason: down ? "UNEXPECTED_STATUS" : null,
          response_excerpt: down ? "upstream unavailable" : null,
          checked_at: checkedAt,
          created_at: checkedAt,
        });
        sequence += 1;
      }
    }
    const latest = checks.at(-1) ?? null;
    const currentCycleId = latest?.cycle_id ?? null;
    monitorRows.push({
      id,
      workspace_id: IDS.workspace,
      name: monitor.name,
      url: monitor.url,
      method: monitor.method,
      encrypted_headers:
        monitor.slug === "checkout_api" ? encryptedCheckoutHeaders : null,
      encrypted_body:
        monitor.slug === "checkout_api" ? encryptedCheckoutBody : null,
      expected_status: monitor.expectedStatus,
      body_condition: monitor.bodyCondition,
      body_expected_value: monitor.bodyExpectedValue,
      body_condition_path: monitor.bodyConditionPath,
      frequency_seconds: monitor.frequencySeconds,
      timeout_seconds: 10,
      max_retries: 1,
      notify_on_recovery: 1,
      next_check_at: now + monitor.frequencySeconds * 1_000,
      current_status: monitor.currentStatus,
      current_cycle_id: currentCycleId,
      cycle_started_at: latest?.checked_at ?? null,
      last_check_at: latest?.checked_at ?? lastCheckAt,
      last_response_time_ms: latest?.response_time_ms ?? null,
      created_by: monitor.createdBy,
      created_at: createdAt,
      updated_at: now,
      deleted_at: null,
    });
    const linked =
      monitor.currentStatus === "DOWN" ? allAlertChannelIds : defaultChannelIds;
    for (const channelId of linked) {
      monitorChannelRows.push({
        uptime_monitor_id: id,
        notification_channel_id: channelId,
      });
    }
    checkRows.push(...checks);
    monitorMeta.set(monitor.slug, { id, latest, checks });
  }
  statements.push(...insertMany("uptime_monitors", monitorRows, 10));
  statements.push(
    ...insertMany("uptime_monitor_channels", monitorChannelRows, 20),
  );

  const incidentDefs = [
    {
      id: "inc_seed_checkout",
      resourceType: "BROWSER_TEST",
      resourceSlug: "checkout",
      status: "OPEN",
      openedAt: now - 6.2 * HOUR_MS,
      resolvedAt: null,
      kind: "run",
    },
    {
      id: "inc_seed_cart",
      resourceType: "BROWSER_TEST",
      resourceSlug: "cart",
      status: "OPEN",
      openedAt: testLatest.get("cart")?.finishedAt ?? now - HOUR_MS,
      resolvedAt: null,
      kind: "run",
    },
    {
      id: "inc_seed_login",
      resourceType: "BROWSER_TEST",
      resourceSlug: "login",
      status: "RESOLVED",
      openedAt: now - 3 * HOUR_MS,
      resolvedAt: now - 25 * MINUTE_MS,
      kind: "run",
    },
    {
      id: "inc_seed_pricing",
      resourceType: "BROWSER_TEST",
      resourceSlug: "pricing",
      status: "RESOLVED",
      openedAt: now - 9 * HOUR_MS,
      resolvedAt: now - 6 * HOUR_MS,
      kind: "run",
    },
    {
      id: "inc_seed_search",
      resourceType: "BROWSER_TEST",
      resourceSlug: "search",
      status: "RESOLVED",
      openedAt: now - 20 * HOUR_MS,
      resolvedAt: now - 18 * HOUR_MS,
      kind: "run",
    },
    {
      id: "inc_seed_homepage_old",
      resourceType: "BROWSER_TEST",
      resourceSlug: "homepage",
      status: "RESOLVED",
      openedAt: now - 4 * DAY_MS,
      resolvedAt: now - 3 * DAY_MS,
      kind: "run",
    },
    {
      id: "inc_seed_api",
      resourceType: "UPTIME_MONITOR",
      resourceSlug: "api",
      status: "OPEN",
      openedAt: now - 8 * HOUR_MS,
      resolvedAt: null,
      kind: "check",
    },
    {
      id: "inc_seed_webhooks",
      resourceType: "UPTIME_MONITOR",
      resourceSlug: "webhooks",
      status: "OPEN",
      openedAt: now - 2 * HOUR_MS,
      resolvedAt: null,
      kind: "check",
    },
    {
      id: "inc_seed_checkout_api",
      resourceType: "UPTIME_MONITOR",
      resourceSlug: "checkout_api",
      status: "RESOLVED",
      openedAt: now - 4.7 * HOUR_MS,
      resolvedAt: now - 4 * HOUR_MS,
      kind: "check",
    },
  ];

  function nearestCheck(slug, timestamp, status = null) {
    const meta = monitorMeta.get(slug);
    if (!meta) return null;
    let best = null;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const check of meta.checks) {
      if (status !== null && check.status !== status) continue;
      const delta = Math.abs(check.checked_at - timestamp);
      if (delta < bestDelta) {
        best = check;
        bestDelta = delta;
      }
    }
    return best;
  }

  function nearestRun(slug, timestamp, status = null) {
    const prefix = `run_seed_${slug}_`;
    let best = null;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const run of runRows) {
      if (!run.id.startsWith(prefix)) continue;
      if (status !== null && run.status !== status) continue;
      const delta = Math.abs(run.finished_at - timestamp);
      if (delta < bestDelta) {
        best = run;
        bestDelta = delta;
      }
    }
    return best;
  }

  const incidentRows = [];
  const eventRows = [];
  const deliveryRows = [];
  let deliverySequence = 0;
  let eventSequence = 0;

  function addEvent(incidentId, type, sourceId, message, createdAt, metadata = null) {
    eventSequence += 1;
    eventRows.push({
      id: `evt_seed_${pad(eventSequence, 3)}`,
      incident_id: incidentId,
      type,
      source_id: sourceId,
      message,
      metadata_json: metadata === null ? null : JSON.stringify(metadata),
      created_at: createdAt,
    });
  }

  function addDelivery(input) {
    deliverySequence += 1;
    const id = `del_seed_${pad(deliverySequence, 3)}`;
    deliveryRows.push({
      id,
      workspace_id: IDS.workspace,
      incident_id: input.incidentId,
      notification_channel_id: input.channelId,
      event_type: input.eventType,
      status: input.status,
      provider_message_id:
        input.status === "SENT" ? `msg_${id}` : null,
      attempt_count: input.status === "FAILED" ? 3 : 1,
      error_sanitized:
        input.status === "FAILED" ? "Webhook returned HTTP 500" : null,
      sent_at: input.status === "SENT" ? input.at + 400 : null,
      created_at: input.at,
      dedupe_key: input.dedupeKey,
      processing_at: null,
    });
    return id;
  }

  for (const incident of incidentDefs) {
    const openedByRun =
      incident.kind === "run"
        ? nearestRun(incident.resourceSlug, incident.openedAt, "FAILED") ??
          nearestRun(incident.resourceSlug, incident.openedAt, "TIMEOUT")
        : null;
    const resolvedByRun =
      incident.status === "RESOLVED" && incident.kind === "run"
        ? nearestRun(incident.resourceSlug, incident.resolvedAt, "PASSED")
        : null;
    const openedByCheck =
      incident.kind === "check"
        ? nearestCheck(incident.resourceSlug, incident.openedAt, "FAILED")
        : null;
    const resolvedByCheck =
      incident.status === "RESOLVED" && incident.kind === "check"
        ? nearestCheck(incident.resourceSlug, incident.resolvedAt, "PASSED")
        : null;
    incidentRows.push({
      id: incident.id,
      workspace_id: IDS.workspace,
      resource_type: incident.resourceType,
      browser_test_id:
        incident.resourceType === "BROWSER_TEST"
          ? `bt_seed_${incident.resourceSlug}`
          : null,
      uptime_monitor_id:
        incident.resourceType === "UPTIME_MONITOR"
          ? `mon_seed_${incident.resourceSlug}`
          : null,
      status: incident.status,
      opened_at: incident.openedAt,
      resolved_at: incident.resolvedAt,
      opened_by_run_id: openedByRun?.id ?? null,
      resolved_by_run_id: resolvedByRun?.id ?? null,
      opened_by_check_id: openedByCheck?.id ?? null,
      resolved_by_check_id: resolvedByCheck?.id ?? null,
      last_event_at: incident.resolvedAt ?? incident.openedAt + 2 * MINUTE_MS,
      created_at: incident.openedAt,
    });

    if (openedByRun) openedByRun.incident_id = incident.id;
    if (resolvedByRun) resolvedByRun.incident_id = incident.id;

    const openSource = openedByRun?.id ?? openedByCheck?.id ?? `src_${incident.id}`;
    const openMessage = openedByRun
      ? `Run ${openedByRun.id} finished ${openedByRun.status}`
      : `Check ${openSource} finished FAILED`;
    addEvent(incident.id, "OPENED", openSource, openMessage, incident.openedAt);

    const notifyChannels =
      incident.status === "OPEN"
        ? [channelIds.email, channelIds.slack, channelIds.sms]
        : [channelIds.email, channelIds.discord];
    for (const [channelIndex, channelId] of notifyChannels.entries()) {
      const failed = channelId === channelIds.slack && incident.id === "inc_seed_checkout";
      const at = incident.openedAt + (channelIndex + 1) * 20_000;
      const deliveryId = addDelivery({
        incidentId: incident.id,
        channelId,
        eventType: "FAILURE",
        status: failed ? "FAILED" : "SENT",
        at,
        dedupeKey: `${incident.kind}:${openSource}:FAILURE:${channelId}`,
      });
      addEvent(
        incident.id,
        failed ? "NOTIFICATION_FAILED" : "NOTIFICATION_SENT",
        deliveryId,
        `Notification via ${channels.find((channel) => channel.id === channelId)?.name}: ${
          failed ? "FAILED" : "SENT"
        }`,
        at + 500,
        {
          channelId,
          channelName: channels.find((channel) => channel.id === channelId)?.name,
          deliveryId,
          status: failed ? "FAILED" : "SENT",
        },
      );
    }

    if (incident.kind === "run" && incident.status === "OPEN") {
      for (const run of runRows) {
        if (run.browser_test_id !== `bt_seed_${incident.resourceSlug}`) continue;
        if (run.id === openedByRun?.id) continue;
        if (run.finished_at < incident.openedAt) continue;
        if (run.status !== "FAILED" && run.status !== "TIMEOUT") continue;
        run.incident_id = incident.id;
        addEvent(
          incident.id,
          "FAILURE_RECORDED",
          run.id,
          `Run ${run.id} finished ${run.status}`,
          run.finished_at,
        );
      }
    }

    if (incident.status === "RESOLVED") {
      const resolveSource =
        resolvedByRun?.id ?? resolvedByCheck?.id ?? `src_${incident.id}_ok`;
      const resolveMessage = resolvedByRun
        ? `Run ${resolvedByRun.id} finished PASSED`
        : `Check ${resolveSource} finished PASSED`;
      addEvent(
        incident.id,
        "RESOLVED",
        resolveSource,
        resolveMessage,
        incident.resolvedAt,
      );
      const recoveryId = addDelivery({
        incidentId: incident.id,
        channelId: channelIds.email,
        eventType: "RECOVERY",
        status: "SENT",
        at: incident.resolvedAt + 8_000,
        dedupeKey: `${incident.kind}:${resolveSource}:RECOVERY:${channelIds.email}`,
      });
      addEvent(
        incident.id,
        "NOTIFICATION_SENT",
        recoveryId,
        "Notification via Staging email: SENT",
        incident.resolvedAt + 8_500,
        {
          channelId: channelIds.email,
          channelName: "Staging email",
          deliveryId: recoveryId,
          status: "SENT",
        },
      );
    }
  }

  addDelivery({
    incidentId: null,
    channelId: channelIds.discord,
    eventType: "TEST",
    status: "SENT",
    at: now - 10 * HOUR_MS,
    dedupeKey: `channel-test:${channelIds.discord}:${now - 10 * HOUR_MS}`,
  });
  addDelivery({
    incidentId: "inc_seed_webhooks",
    channelId: channelIds.slack,
    eventType: "FAILURE",
    status: "FAILED",
    at: now - 90 * MINUTE_MS,
    dedupeKey: `uptime-check:webhooks:FAILURE:${channelIds.slack}:late`,
  });

  statements.push(...insertMany("test_runs", runRows));
  statements.push(...insertMany("test_attempts", attemptRows));
  statements.push(...insertMany("run_steps", stepRows));
  statements.push(...insertMany("usage_events", usageRows));
  statements.push(...insertMany("uptime_checks", checkRows));
  statements.push(...insertMany("incidents", incidentRows));
  statements.push(...insertMany("incident_events", eventRows));
  statements.push(...insertMany("notification_deliveries", deliveryRows));

  const auditEntries = [
    {
      action: "workspace.created",
      actor: IDS.owner,
      resourceType: "workspace",
      resourceId: IDS.workspace,
      metadata: { name: "Aguayo Staging" },
      at: workspaceCreated,
    },
    {
      action: "billing.grant_redeemed",
      actor: IDS.owner,
      resourceType: "subscription",
      resourceId: IDS.subscription,
      metadata: { source: "grant" },
      at: workspaceCreated + 5 * MINUTE_MS,
    },
    {
      action: "member.joined",
      actor: IDS.admin,
      resourceType: "member",
      resourceId: IDS.adminMember,
      metadata: { role: "ADMIN" },
      at: workspaceCreated + 2 * DAY_MS,
    },
    {
      action: "member.invited",
      actor: IDS.owner,
      resourceType: "invitation",
      resourceId: "inv_seed_noelia",
      metadata: { email: "noelia@zenguy.dev", role: "ADMIN" },
      at: now - 2 * DAY_MS,
    },
    {
      action: "member.invitation_revoked",
      actor: IDS.owner,
      resourceType: "invitation",
      resourceId: "inv_seed_intern",
      metadata: { email: "intern@zenguy.dev" },
      at: now - 3 * DAY_MS,
    },
    {
      action: "secret.created",
      actor: IDS.owner,
      resourceType: "secret",
      resourceId: "sec_seed_demo",
      metadata: { key: "DEMO_TOKEN" },
      at: workspaceCreated + DAY_MS,
    },
    {
      action: "secret.updated",
      actor: IDS.admin,
      resourceType: "secret",
      resourceId: "sec_seed_stripe",
      metadata: { key: "STRIPE_TEST_KEY" },
      at: now - 9 * DAY_MS,
    },
    {
      action: "channel.created",
      actor: IDS.owner,
      resourceType: "channel",
      resourceId: channelIds.email,
      metadata: { type: "EMAIL" },
      at: workspaceCreated + 2 * DAY_MS,
    },
    {
      action: "channel.tested",
      actor: IDS.admin,
      resourceType: "channel",
      resourceId: channelIds.discord,
      metadata: { status: "SENT" },
      at: now - 10 * HOUR_MS,
    },
    {
      action: "test.created",
      actor: IDS.owner,
      resourceType: "browser_test",
      resourceId: "bt_seed_homepage",
      metadata: { name: "Homepage smoke" },
      at: workspaceCreated + 3 * DAY_MS,
    },
    {
      action: "test.updated",
      actor: IDS.admin,
      resourceType: "browser_test",
      resourceId: "bt_seed_checkout",
      metadata: { name: "Checkout flow" },
      at: now - 5 * DAY_MS,
    },
    {
      action: "test.run_manual",
      actor: IDS.owner,
      resourceType: "browser_test",
      resourceId: "bt_seed_homepage",
      metadata: { runId: testLatest.get("homepage")?.runId },
      at: testLatest.get("homepage")?.queuedAt ?? now - HOUR_MS,
    },
    {
      action: "monitor.created",
      actor: IDS.owner,
      resourceType: "uptime_monitor",
      resourceId: "mon_seed_homepage",
      metadata: { name: "Homepage beat" },
      at: workspaceCreated + 4 * DAY_MS,
    },
    {
      action: "monitor.updated",
      actor: IDS.admin,
      resourceType: "uptime_monitor",
      resourceId: "mon_seed_api",
      metadata: { name: "API beat" },
      at: now - 2 * DAY_MS,
    },
    {
      action: "api_key.created",
      actor: IDS.owner,
      resourceType: "api_key",
      resourceId: "ak_seed_status",
      metadata: { name: "Status dashboard", keyPrefix: "zgk_seedstat" },
      at: now - 12 * DAY_MS,
    },
    {
      action: "api_key.revoked",
      actor: IDS.admin,
      resourceType: "api_key",
      resourceId: "ak_seed_legacy",
      metadata: { name: "Legacy CLI" },
      at: now - 14 * DAY_MS,
    },
    {
      action: "workspace.updated",
      actor: IDS.owner,
      resourceType: "workspace",
      resourceId: IDS.workspace,
      metadata: { timezone: "Europe/Madrid" },
      at: now - 7 * DAY_MS,
    },
    {
      action: "member.role_changed",
      actor: IDS.owner,
      resourceType: "member",
      resourceId: IDS.memberMember,
      metadata: { from: "MEMBER", to: "MEMBER" },
      at: now - 11 * DAY_MS,
    },
    {
      action: "channel.updated",
      actor: IDS.admin,
      resourceType: "channel",
      resourceId: channelIds.call,
      metadata: { enabled: false },
      at: now - 4 * DAY_MS,
    },
    {
      action: "secret.created",
      actor: IDS.admin,
      resourceType: "secret",
      resourceId: "sec_seed_otp",
      metadata: { key: "ADMIN_OTP" },
      at: workspaceCreated + 9 * DAY_MS,
    },
    {
      action: "test.created",
      actor: IDS.admin,
      resourceType: "browser_test",
      resourceId: "bt_seed_pricing",
      metadata: { name: "Pricing page" },
      at: workspaceCreated + 8 * DAY_MS,
    },
    {
      action: "monitor.created",
      actor: IDS.admin,
      resourceType: "uptime_monitor",
      resourceId: "mon_seed_webhooks",
      metadata: { name: "Webhooks receiver" },
      at: workspaceCreated + 12 * DAY_MS,
    },
    {
      action: "member.joined",
      actor: IDS.memberTwo,
      resourceType: "member",
      resourceId: IDS.memberTwoMember,
      metadata: { role: "MEMBER" },
      at: workspaceCreated + 20 * DAY_MS,
    },
    {
      action: "member.joined",
      actor: IDS.memberThree,
      resourceType: "member",
      resourceId: IDS.memberThreeMember,
      metadata: { role: "MEMBER" },
      at: workspaceCreated + 30 * DAY_MS,
    },
    {
      action: "channel.created",
      actor: IDS.owner,
      resourceType: "channel",
      resourceId: channelIds.slack,
      metadata: { type: "SLACK" },
      at: workspaceCreated + 5 * DAY_MS,
    },
    {
      action: "test.run_manual",
      actor: IDS.owner,
      resourceType: "browser_test",
      resourceId: "bt_seed_pricing",
      metadata: { runId: testLatest.get("pricing")?.runId },
      at: testLatest.get("pricing")?.queuedAt ?? now - 2 * HOUR_MS,
    },
    {
      action: "workspace.updated",
      actor: IDS.admin,
      resourceType: "workspace",
      resourceId: IDS.workspace,
      metadata: { name: "Aguayo Staging" },
      at: now - 16 * HOUR_MS,
    },
    {
      action: "secret.created",
      actor: IDS.owner,
      resourceType: "secret",
      resourceId: "sec_seed_session",
      metadata: { key: "SESSION_COOKIE" },
      at: workspaceCreated + 7 * DAY_MS,
    },
    {
      action: "monitor.created",
      actor: IDS.owner,
      resourceType: "uptime_monitor",
      resourceId: "mon_seed_billing",
      metadata: { name: "Billing API" },
      at: now - 2 * HOUR_MS,
    },
    {
      action: "member.invited",
      actor: IDS.admin,
      resourceType: "invitation",
      resourceId: "inv_seed_sofia",
      metadata: { email: "sofia@zenguy.dev", role: "MEMBER" },
      at: now - 12 * HOUR_MS,
    },
  ];
  statements.push(
    ...insertMany(
      "audit_logs",
      auditEntries.map((entry, index) => ({
        id: `aud_seed_${pad(index + 1, 3)}`,
        workspace_id: IDS.workspace,
        actor_user_id: entry.actor,
        action: entry.action,
        resource_type: entry.resourceType,
        resource_id: entry.resourceId,
        metadata_json: JSON.stringify(entry.metadata),
        ip: index % 2 === 0 ? "83.32.14.10" : "80.58.0.33",
        created_at: entry.at,
      })),
    ),
  );

  statements.push("");
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
