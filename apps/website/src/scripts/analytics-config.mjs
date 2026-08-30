export const CONSENT_KEY = "zenguy:cookie-consent:v1";
// Version 2 covers the campaign/CTA taxonomy and the app's separately
// consented pseudonymous account measurement. Old choices are renewed.
export const CONSENT_VERSION = 2;
export const CONSENT_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1_000;
export const FUTURE_CLOCK_TOLERANCE_MS = 5 * 60 * 1_000;
export const MEASUREMENT_ID = "G-P2HSMZMWVB";
export const GA_COOKIE_DOMAIN = "none";
export const ANALYTICS_SURFACE = "public_web";
export const ANALYTICS_CAMPAIGN_SESSION_KEY =
  "zenguy:analytics-campaign:v1";

// These exported catalogs are the complete cross-surface contract. New
// campaign labels must be deliberately added here (and later mirrored by the
// app); arbitrary URL values are never forwarded to Analytics.
export const ANALYTICS_CAMPAIGN_SOURCES = Object.freeze([
  "bing",
  "facebook",
  "google",
  "instagram",
  "linkedin",
  "newsletter",
  "other",
  "partner",
  "product_hunt",
  "reddit",
  "x",
  "youtube",
  "zenguy_public",
]);
export const ANALYTICS_CAMPAIGN_MEDIA = Object.freeze([
  "affiliate",
  "cpc",
  "display",
  "email",
  "organic",
  "other",
  "owned",
  "paid_social",
  "referral",
  "social",
]);
export const ANALYTICS_CAMPAIGN_NAMES = Object.freeze([
  "august_launch",
  "brand",
  "launch",
  "newsletter",
  "other",
  "product_launch",
  "q3_launch",
  "site_to_app",
]);
export const ANALYTICS_CAMPAIGN_CONTENT = Object.freeze([
  "article",
  "closing",
  "control",
  "entry",
  "hero",
  "hero_cta",
  "nav",
  "other",
  "pricing",
  "uptime",
  "variant_a",
  "variant_b",
]);
export const ANALYTICS_CAMPAIGN_CATALOG = Object.freeze({
  source: ANALYTICS_CAMPAIGN_SOURCES,
  medium: ANALYTICS_CAMPAIGN_MEDIA,
  name: ANALYTICS_CAMPAIGN_NAMES,
  content: ANALYTICS_CAMPAIGN_CONTENT,
});

const LEGAL_PATHS = new Set([
  "/cookies",
  "/legal-notice",
  "/privacy",
  "/terms",
]);
const CAMPAIGN_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
];
const CAMPAIGN_KEY_SET = new Set(CAMPAIGN_KEYS);
const CAMPAIGN_VALUE_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const TOKEN_WORD_PATTERN = /(?:^|[._-])(?:access[-_]?token|authorization|bearer|jwt|password|secret|token)(?:$|[._-])/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LONG_IDENTIFIER_PATTERN = /^(?:[a-f0-9]{24,}|[a-z0-9]{32,}|\d{10,})$/;
const CAMPAIGN_SOURCE_SET = new Set(ANALYTICS_CAMPAIGN_SOURCES);
const CAMPAIGN_MEDIUM_SET = new Set(ANALYTICS_CAMPAIGN_MEDIA);
const CAMPAIGN_NAME_SET = new Set(ANALYTICS_CAMPAIGN_NAMES);
const CAMPAIGN_CONTENT_SET = new Set(ANALYTICS_CAMPAIGN_CONTENT);

export const ANALYTICS_CTA_LOCATIONS = Object.freeze([
  "article_signup",
  "closing_signup",
  "hero_signup",
  "nav_signin",
  "nav_signup",
  "pricing_signup",
  "uptime_signup",
]);
export const ANALYTICS_CTA_DESTINATIONS = Object.freeze([
  "signin",
  "signup",
]);

const ANALYTICS_CTA_LOCATION_SET = new Set(ANALYTICS_CTA_LOCATIONS);
const ANALYTICS_CTA_DESTINATION_PATHS = new Map([
  ["signin", "/signin"],
  ["signup", "/signup"],
]);
const APP_ORIGIN = "https://app.zenguy.com";
const FALLBACK_APP_CAMPAIGN = Object.freeze({
  campaign_source: "zenguy_public",
  campaign_medium: "owned",
  campaign_name: "site_to_app",
});

const PRODUCTION_HOSTS = new Set(["zenguy.com", "www.zenguy.com"]);

/** @param {{ hostname: string; port: string; protocol: string }} location */
export function isAnalyticsProductionLocation(location) {
  return (
    location.protocol === "https:" &&
    location.port === "" &&
    PRODUCTION_HOSTS.has(location.hostname)
  );
}

/** @param {unknown} value @param {number} [now] */
export function isConsentRecord(value, now = Date.now()) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = /** @type {Record<string, unknown>} */ (value);
  const keys = Object.keys(candidate).sort();
  if (keys.join(",") !== "analytics,updatedAt,version") return false;
  if (
    candidate.version !== CONSENT_VERSION ||
    typeof candidate.analytics !== "boolean" ||
    typeof candidate.updatedAt !== "string"
  ) {
    return false;
  }

  const updatedAt = Date.parse(candidate.updatedAt);
  return (
    Number.isFinite(updatedAt) &&
    updatedAt <= now + FUTURE_CLOCK_TOLERANCE_MS &&
    now - updatedAt <= CONSENT_MAX_AGE_MS
  );
}

/** @param {{ origin: string; pathname: string }} location */
export function cleanPageLocation(location) {
  return new URL(location.pathname, location.origin).href;
}

/**
 * Keep the reporting taxonomy finite even when the requested URL is not.
 * @param {string} pathname
 */
export function publicPageAnalyticsContext(pathname) {
  const normalized = normalizePathname(pathname);
  let contentGroup = "error";

  if (normalized === "/") contentGroup = "public_home";
  else if (normalized === "/proposal1") contentGroup = "public_landing";
  else if (normalized === "/articles") contentGroup = "public_content_hub";
  else if (normalized.startsWith("/articles/")) contentGroup = "public_article";
  else if (LEGAL_PATHS.has(normalized)) contentGroup = "public_legal";

  return { surface: ANALYTICS_SURFACE, content_group: contentGroup };
}

/**
 * Return only a complete campaign built from the exported finite catalogs.
 * URLSearchParams has already decoded percent escapes, so unsafe emails and
 * token-like values are rejected. Benign but unknown source/medium/name labels
 * collapse to `other`; unknown optional creative content is dropped.
 * @param {URLSearchParams} searchParams
 * @returns {{campaign_source: string; campaign_medium: string; campaign_name: string; campaign_content?: string} | null}
 */
export function parseSafeCampaign(searchParams) {
  if (!(searchParams instanceof URLSearchParams)) return null;

  for (const [key] of searchParams) {
    if (key.toLowerCase().startsWith("utm_") && !CAMPAIGN_KEY_SET.has(key)) {
      return null;
    }
  }

  const values = new Map();
  for (const key of CAMPAIGN_KEYS) {
    const candidates = searchParams.getAll(key);
    if (candidates.length > 1) return null;
    if (candidates.length === 0) continue;
    const value = normalizeCampaignValue(candidates[0]);
    if (value === null) return null;
    values.set(key, value);
  }

  const source = values.get("utm_source");
  const medium = values.get("utm_medium");
  const name = values.get("utm_campaign");
  if (!source || !medium || !name) return null;

  const campaign = {
    campaign_source: catalogValue(source, CAMPAIGN_SOURCE_SET) ?? "other",
    campaign_medium: catalogValue(medium, CAMPAIGN_MEDIUM_SET) ?? "other",
    campaign_name: catalogValue(name, CAMPAIGN_NAME_SET) ?? "other",
  };
  const content = values.get("utm_content");
  const catalogContent = catalogValue(content, CAMPAIGN_CONTENT_SET);
  if (catalogContent) campaign.campaign_content = catalogContent;
  return campaign;
}

/**
 * Validate a campaign read from session storage without accepting extra keys
 * or values outside the finite catalogs.
 * @param {unknown} value
 */
export function isSafeCampaign(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = /** @type {Record<string, unknown>} */ (value);
  const keys = Object.keys(candidate).sort().join(",");
  if (
    keys !== "campaign_medium,campaign_name,campaign_source" &&
    keys !== "campaign_content,campaign_medium,campaign_name,campaign_source"
  ) {
    return false;
  }
  return (
    typeof candidate.campaign_source === "string" &&
    CAMPAIGN_SOURCE_SET.has(candidate.campaign_source) &&
    typeof candidate.campaign_medium === "string" &&
    CAMPAIGN_MEDIUM_SET.has(candidate.campaign_medium) &&
    typeof candidate.campaign_name === "string" &&
    CAMPAIGN_NAME_SET.has(candidate.campaign_name) &&
    (candidate.campaign_content === undefined ||
      (typeof candidate.campaign_content === "string" &&
        CAMPAIGN_CONTENT_SET.has(candidate.campaign_content)))
  );
}

/**
 * Resolve attribution for a new document without letting a malformed incoming
 * campaign inherit a previous session's attribution. Stored attribution is
 * eligible only when the current URL contains no `utm_*` key at all.
 * @param {URLSearchParams} searchParams
 * @param {unknown} storedCampaign
 * @returns {{campaign: {campaign_source: string; campaign_medium: string; campaign_name: string; campaign_content?: string} | null; source: "url" | "session" | "invalid_url" | "none"}}
 */
export function resolveSafeCampaign(searchParams, storedCampaign) {
  const entryCampaign = parseSafeCampaign(searchParams);
  if (entryCampaign !== null) {
    return { campaign: entryCampaign, source: "url" };
  }
  if (hasUtmParameter(searchParams)) {
    return { campaign: null, source: "invalid_url" };
  }
  if (isSafeCampaign(storedCampaign)) {
    return { campaign: storedCampaign, source: "session" };
  }
  return { campaign: null, source: "none" };
}

/** @param {unknown} value */
export function isAllowedAnalyticsCtaLocation(value) {
  return typeof value === "string" && ANALYTICS_CTA_LOCATION_SET.has(value);
}

/** @param {unknown} value */
export function isAllowedAnalyticsCtaDestination(value) {
  return (
    typeof value === "string" &&
    ANALYTICS_CTA_DESTINATION_PATHS.has(value)
  );
}

/**
 * Add a validated campaign (or a fixed first-party fallback) to one of the two
 * approved app destinations. Existing query strings and fragments are
 * discarded. A validated creative remains utm_content; the CTA location uses
 * the first-party `zg_cta` key and can never contain a free-form value.
 * @param {string} href
 * @param {unknown} validatedCampaign
 * @param {string} ctaLocation
 * @param {string} ctaDestination
 * @returns {string | null}
 */
export function buildTrackedAppHref(
  href,
  validatedCampaign,
  ctaLocation,
  ctaDestination,
) {
  if (
    !isAllowedAnalyticsCtaLocation(ctaLocation) ||
    !isAllowedAnalyticsCtaDestination(ctaDestination)
  ) {
    return null;
  }

  let destination;
  try {
    destination = new URL(href);
  } catch {
    return null;
  }

  const expectedPath = ANALYTICS_CTA_DESTINATION_PATHS.get(ctaDestination);
  if (
    destination.origin !== APP_ORIGIN ||
    destination.pathname.replace(/\/$/, "") !== expectedPath
  ) {
    return null;
  }

  const campaign = isSafeCampaign(validatedCampaign)
    ? validatedCampaign
    : FALLBACK_APP_CAMPAIGN;
  destination.search = "";
  destination.hash = "";
  destination.searchParams.set("utm_source", campaign.campaign_source);
  destination.searchParams.set("utm_medium", campaign.campaign_medium);
  destination.searchParams.set("utm_campaign", campaign.campaign_name);
  if (campaign.campaign_content) {
    destination.searchParams.set("utm_content", campaign.campaign_content);
  }
  destination.searchParams.set("zg_cta", ctaLocation);
  return destination.href;
}

/** @param {string} pathname */
function normalizePathname(pathname) {
  if (typeof pathname !== "string" || !pathname.startsWith("/")) return "";
  const withoutQuery = pathname.split(/[?#]/, 1)[0] ?? "";
  if (withoutQuery === "/") return "/";
  return withoutQuery.replace(/\/+$/, "");
}

/** @param {string} rawValue */
function normalizeCampaignValue(rawValue) {
  if (rawValue.includes("@")) return null;
  const decoded = rawValue
    .normalize("NFKC")
    .trim()
    .toLowerCase();
  if (UUID_PATTERN.test(decoded)) return null;
  const normalized = decoded.replace(/[\s.-]+/g, "_");

  if (
    normalized.length === 0 ||
    normalized.length > 64 ||
    !CAMPAIGN_VALUE_PATTERN.test(normalized) ||
    normalized.includes("@") ||
    UUID_PATTERN.test(normalized) ||
    LONG_IDENTIFIER_PATTERN.test(normalized) ||
    TOKEN_WORD_PATTERN.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

/** @param {unknown} value @param {Set<string>} catalog */
function catalogValue(value, catalog) {
  return typeof value === "string" && catalog.has(value) ? value : null;
}

/** @param {URLSearchParams} searchParams */
function hasUtmParameter(searchParams) {
  if (!(searchParams instanceof URLSearchParams)) return false;
  for (const [key] of searchParams) {
    if (key.toLowerCase().startsWith("utm_")) return true;
  }
  return false;
}
