export const RUNNER_VERSION = "zenguy-local-runner/1.0.0";
// Oldest iOS app build allowed to use the API (apps/app). Bump it to force an
// update: older apps compare their version against GET /api/app/version and
// show a blocking "update required" screen with the App Store link.
export const MIN_APP_VERSION = "0.1.0";
export const ACCESS_TOKEN_TTL_SECONDS = 1800;
export const REFRESH_TOKEN_TTL_DAYS = 30;
export const PUSH_DEVICE_INACTIVITY_TTL_DAYS = 90;
export const EMAIL_VERIFY_TTL_HOURS = 24;
export const PASSWORD_RESET_TTL_HOURS = 1;
export const INVITATION_TTL_DAYS = 7;
// Cloudflare Workers exposes PBKDF2, but not Argon2id, through Web Crypto. The
// explicit scheme/version and encoded work factor let login migrate old
// records without invalidating credentials.
export const PASSWORD_HASH_SCHEME = "pbkdf2-sha256";
export const PASSWORD_HASH_VERSION = "v1";
// Deployed Workers reject PBKDF2 above 100k iterations as a DoS guard
// (NotSupportedError from deriveBits; workerd issue #1346). Local workerd and
// CI do not enforce the cap, so any higher value only fails in production:
// hashPassword throws on register/reset and on the login rehash path.
// Raising the work factor beyond this requires leaving Workers PBKDF2
// (e.g. WASM Argon2id), not editing this constant.
export const PBKDF2_ITERATIONS = 100_000;
// Reject corrupted/hostile database records before they can force an
// unbounded KDF. A future factor above this ceiling requires a format/version
// rollout first, which keeps old deployments from silently accepting it.
export const PBKDF2_MAX_VERIFY_ITERATIONS = 1_200_000;
export const PASSWORD_KDF_TARGET_MAX_MS = 1_000;
export const LEGAL_VERSION = "2026-09-01";
export const MIN_PASSWORD_LENGTH = 15;
export const MAX_PASSWORD_LENGTH = 100;

export const PLAN_PRICE_CENTS = 3900;
export const INCLUDED_RUNS = 300;
export const MAX_ACTIVE_RUNS_PER_WORKSPACE = 10;
export const MAX_ACTIVE_RUNS_PER_USER = 10;
export const MAX_ACTIVE_RUNS_PER_OWNER = 20;
export const MAX_ACTIVE_RUNS_GLOBAL = 100;
export const MAX_DAILY_RUNS_PER_WORKSPACE = 1_000;
export const MAX_DAILY_RUNS_PER_USER = 1_000;
export const MAX_DAILY_RUNS_PER_OWNER = 3_000;
export const MAX_DAILY_RUNS_GLOBAL = 10_000;
export const MAX_MONTHLY_RUNS_PER_WORKSPACE = 10_000;
export const MAX_MONTHLY_RUNS_PER_USER = 10_000;
export const MAX_MONTHLY_RUNS_PER_OWNER = 30_000;
export const MAX_MONTHLY_RUNS_GLOBAL = 100_000;
export const MAX_OWNED_WORKSPACES = 3;
export const OVERAGE_CENTS_PER_RUN = 20;
export const SUBSCRIPTION_GRANT_TTL_DAYS = 30;
export const COMPLIMENTARY_PERIOD_MS = 10 * 365 * 24 * 60 * 60 * 1_000;

export const ATTEMPT_TIMEOUT_MS = 300_000;
export const MAX_FUNCTIONAL_RETRIES = 3;
export const RETRY_DELAY_SECONDS: Record<number, number> = {
  1: 0,
  2: 60,
  3: 120,
};
export const MAX_INFRA_RETRIES = 2;
export const INFRA_RETRY_DELAY_SECONDS = 30;
// A queued attempt older than this may be claimed by the fallback runner; the
// primary (local) worker keeps exclusive first access during the window.
export const FALLBACK_CLAIM_MIN_AGE_MS = 10_000;
// A runner worker that has not sent a heartbeat for this long is shown as
// offline (3 missed 5-second heartbeats). apps/admin replicates this value.
export const RUNNER_ONLINE_THRESHOLD_MS = 15_000;

export const MAX_AGENT_STEPS = 40;
export const MAX_ELEMENTS = 150;
export const MAX_SCREENSHOTS_PER_ATTEMPT = 45;
export const MAX_CONSOLE_ENTRIES = 50;
export const MAX_NETWORK_ENTRIES = 50;
export const TOKEN_LIMIT_PER_ATTEMPT = 200_000;
export const SCREENSHOT_JPEG_QUALITY = 60;

export const UPTIME_FREQUENCIES_SECONDS = [
  300, 600, 900, 1800, 3600, 10800, 21600, 43200, 86400,
] as const;
export const MAX_REDIRECTS = 5;
export const UPTIME_BODY_CAP = 524_288;
export const UPTIME_EXCERPT_MAX = 2048;

// Most API payloads are small JSON documents. Only browser-test imports and a
// runner step containing one bounded base64 JPEG receive larger route-specific
// limits before any parser materializes the body.
export const MAX_STANDARD_API_REQUEST_BODY_BYTES = 256 * 1024;
export const MAX_BROWSER_TEST_IMPORT_BODY_BYTES = 2_000_000;
export const MAX_API_REQUEST_BODY_BYTES = 3_200_000;
export const MAX_PADDLE_WEBHOOK_BODY_BYTES = 256 * 1024;
export const MAX_STRIPE_WEBHOOK_BODY_BYTES = 256 * 1024;

export const RETENTION_DAYS = 30;
export const ARTIFACT_SIG_TTL_SECONDS = 600;

export const API_KEY_PREFIX = "zgk_";
export const API_KEY_TOKEN_BYTES = 32;
export const API_KEY_DISPLAY_PREFIX_LENGTH = 12;
export const MAX_ACTIVE_API_KEYS_PER_WORKSPACE = 20;
export const API_KEY_DEFAULT_TTL_DAYS = 90;
export const API_KEY_MAX_TTL_DAYS = 365;
export const PAST_DUE_GRACE_DAYS = 7;
export const MAX_BROWSER_TESTS_PER_WORKSPACE = 200;
export const MAX_SECRETS_PER_WORKSPACE = 100;
export const MAX_CHANNELS_PER_WORKSPACE = 50;
export const MAX_STATUS_PAGES_PER_WORKSPACE = 5;
export const MAX_STATUS_PAGE_ITEMS = 50;
export const MAX_INCIDENT_UPDATE_LENGTH = 2000;
export const STATUS_PAGE_HISTORY_DAYS = 90;
export const STATUS_PAGE_RECENT_INCIDENT_DAYS = 15;

export const DEVICE_PROFILES = {
  DESKTOP: {
    width: 1440,
    height: 900,
    isMobile: false,
    hasTouch: false,
    deviceScaleFactor: 1,
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  },
  MOBILE: {
    width: 390,
    height: 844,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  },
} as const;

export const RATE_LIMITS = {
  register: { limit: 5, windowSeconds: 3600 },
  login: { limit: 10, windowSeconds: 300 },
  forgot: { limit: 3, windowSeconds: 3600 },
  resend: { limit: 3, windowSeconds: 3600 },
  verify_email: { limit: 5, windowSeconds: 900 },
  reset_password: { limit: 5, windowSeconds: 900 },
  account_delete: { limit: 5, windowSeconds: 900 },
  invitations: { limit: 20, windowSeconds: 86400 },
  /** Shared across object types so alternating resources cannot bypass quotas. */
  collection_create: { limit: 30, windowSeconds: 3600 },
  browser_test_create: { limit: 30, windowSeconds: 3600 },
  run_create: { limit: 10, windowSeconds: 60 },
  channel_test: { limit: 5, windowSeconds: 3600 },
  monitor_create: { limit: 30, windowSeconds: 3600 },
  test_request: { limit: 30, windowSeconds: 3600 },
  test_import: { limit: 10, windowSeconds: 3600 },
  report_download: { limit: 60, windowSeconds: 3600 },
  public_api: { limit: 120, windowSeconds: 60 },
  /** Anonymous public status-page views, per source IP, applied on cache miss. */
  status_page: { limit: 120, windowSeconds: 60 },
  subscription_grants: { limit: 20, windowSeconds: 3600 },
  /**
   * Best-effort telemetry, capped per actor and per source IP. Clients flush
   * one batch per navigation (1 s debounce), so the budget is in batches: a
   * person rarely exceeds ~60 page views a minute, and an office NAT shares
   * the IP scope, hence 120.
   */
  events: { limit: 120, windowSeconds: 60 },
  /** Long-window storage budget: 5,000 batches (≤ 125,000 events) per actor/IP/day. */
  events_daily: { limit: 5_000, windowSeconds: 86_400 },
  /**
   * Circuit breaker so telemetry fails before core product data can exhaust
   * the shared D1 store: ~2.5× the expected daily batch volume at 100 active
   * users (spec §11); raise when the product grows.
   */
  events_global_daily: { limit: 50_000, windowSeconds: 86_400 },
} as const;
