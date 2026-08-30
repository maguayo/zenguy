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

// --- /api/metrics windows (Marcos' definitions, 2026-08-30 spec) ---
export const ACTIVE_WINDOW_MS = 7 * DAY_MS;
export const DANGER_WINDOW_MS = 14 * DAY_MS;
export const FAILED_RECENT_WINDOW_MS = 2 * HOUR_MS;

/**
 * Estimated LLM cost in USD cents per 1M tokens, keyed by
 * test_attempts.model_name. The database stores tokens, never money — edit the
 * rates here when providers reprice or the runner switches models. Unknown
 * models fall back to DEFAULT_MODEL_PRICE (the paid fallback's rates) so new
 * models overestimate rather than hide spend.
 */
export interface ModelPrice {
  inputCentsPerMTok: number;
  outputCentsPerMTok: number;
}
export const MODEL_PRICES: Record<string, ModelPrice> = {
  // Primary (Mac) runner model, self-hosted: no per-token bill.
  "qwen/qwen3.8-27b": { inputCentsPerMTok: 0, outputCentsPerMTok: 0 },
  // OpenAI list prices since 2026-07-30. The Cloudflare Containers runner
  // ("cf") uses luna for every test unless ZENGUY_FALLBACK_MODEL says otherwise.
  // Prompt caching is not discounted here, so this is an upper bound.
  "gpt-5.6-luna": { inputCentsPerMTok: 20, outputCentsPerMTok: 120 },
  "gpt-5.6-terra": { inputCentsPerMTok: 200, outputCentsPerMTok: 1_200 },
};
export const DEFAULT_MODEL_PRICE: ModelPrice = MODEL_PRICES["gpt-5.6-luna"] as ModelPrice;
