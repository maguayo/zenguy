// Mirrors RUNNER_ONLINE_THRESHOLD_MS in apps/api/src/shared/constants.ts
// (3 missed 5-second heartbeats). Keep both in sync.
export const RUNNER_ONLINE_THRESHOLD_MS = 15_000;
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const SESSION_COOKIE = "zenguy_admin_session";
export const LOGIN_FAILURE_DELAY_MS = 300;
export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 200;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;
