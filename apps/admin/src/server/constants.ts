// Mirrors RUNNER_ONLINE_THRESHOLD_MS in apps/api/src/shared/constants.ts
// (3 missed 5-second heartbeats). Keep both in sync.
export const RUNNER_ONLINE_THRESHOLD_MS = 15_000;
// Admin sessions are deliberately much shorter than product sessions. The
// opaque token is revocable server-side and the __Host- prefix prevents a
// sibling subdomain from planting or shadowing it.
export const SESSION_TTL_MS = 30 * 60 * 1_000;
export const SESSION_COOKIE = "__Host-zenguy_admin_session";
export const LOGIN_FAILURE_DELAY_MS = 300;
// Admin API requests are tiny (the largest is the login payload). Bound every
// request stream before any route-level JSON parser can materialize it.
export const MAX_ADMIN_API_REQUEST_BODY_BYTES = 8 * 1024;
export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 200;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;
