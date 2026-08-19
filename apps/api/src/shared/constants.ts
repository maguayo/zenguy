export const RUNNER_VERSION = "zenguy-runner/1.0.0";
export const ACCESS_TOKEN_TTL_SECONDS = 1800;
export const REFRESH_TOKEN_TTL_DAYS = 30;
export const EMAIL_VERIFY_TTL_HOURS = 24;
export const PASSWORD_RESET_TTL_HOURS = 1;
export const INVITATION_TTL_DAYS = 7;
export const PBKDF2_ITERATIONS = 100_000;

export const PLAN_PRICE_CENTS = 3900;
export const INCLUDED_RUNS = 300;
export const OVERAGE_CENTS_PER_RUN = 20;

export const ATTEMPT_TIMEOUT_MS = 300_000;
export const MAX_FUNCTIONAL_RETRIES = 3;
export const RETRY_DELAY_SECONDS: Record<number, number> = {
  1: 0,
  2: 60,
  3: 120,
};
export const MAX_INFRA_RETRIES = 2;
export const INFRA_RETRY_DELAY_SECONDS = 30;

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

export const RETENTION_DAYS = 30;
export const ARTIFACT_SIG_TTL_SECONDS = 600;

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
  invitations: { limit: 20, windowSeconds: 86400 },
  run_create: { limit: 10, windowSeconds: 60 },
  channel_test: { limit: 5, windowSeconds: 3600 },
  monitor_create: { limit: 30, windowSeconds: 3600 },
  test_request: { limit: 30, windowSeconds: 3600 },
  report_download: { limit: 60, windowSeconds: 3600 },
} as const;
