import type {
  Billing,
  BillingCurrency,
  BillingPlanPrice,
  Role,
  SubscriptionStatus,
  User,
} from "../../api/types";
import {
  analyticsClassificationFor,
  analyticsRoutePatternFor,
  isAnalyticsRoutePattern,
} from "../activity/route-events";
import {
  isAnalyticsProductionHost,
  readCookieConsent,
} from "./consent";

export const GA4_MEASUREMENT_ID = "G-P2HSMZMWVB";
export const GA4_SCRIPT_ID = "zenguy-ga4";
export const GA4_SCRIPT_URL = `https://www.googletagmanager.com/gtag/js?id=${GA4_MEASUREMENT_ID}`;

const RECENT_INVOICE_WINDOW_MS = 24 * 60 * 60 * 1_000;
const CHECKOUT_CLOCK_TOLERANCE_MS = 5 * 60 * 1_000;
const INITIAL_INVOICE_TOLERANCE_MS = 60 * 60 * 1_000;
const CHECKOUT_CORRELATION_PREFIX =
  "zenguy:analytics:pending-subscription-checkout:v1:";

type CheckoutCorrelationStorage = Pick<
  Storage,
  "getItem" | "removeItem" | "setItem"
>;

function browserSessionStorage(): CheckoutCorrelationStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function checkoutCorrelationKey(workspaceId: string): string {
  return `${CHECKOUT_CORRELATION_PREFIX}${encodeURIComponent(workspaceId)}`;
}

/**
 * A purchase may be emitted only after this browser tab actually initiated a
 * live subscription checkout. The marker is short-lived session storage and
 * never leaves the browser.
 */
export function rememberSubscriptionCheckout(
  workspaceId: string,
  storage: CheckoutCorrelationStorage | null = browserSessionStorage(),
  now = Date.now(),
): boolean {
  if (storage === null || workspaceId.length === 0 || !Number.isFinite(now)) {
    return false;
  }
  try {
    storage.setItem(checkoutCorrelationKey(workspaceId), String(now));
    return storage.getItem(checkoutCorrelationKey(workspaceId)) === String(now);
  } catch {
    return false;
  }
}

export function readRememberedSubscriptionCheckout(
  workspaceId: string,
  storage: CheckoutCorrelationStorage | null = browserSessionStorage(),
  now = Date.now(),
): number | null {
  if (storage === null || workspaceId.length === 0) return null;
  try {
    const key = checkoutCorrelationKey(workspaceId);
    const raw = storage.getItem(key);
    if (raw === null) return null;
    const startedAt = Number(raw);
    if (
      !Number.isFinite(startedAt) ||
      startedAt > now + CHECKOUT_CLOCK_TOLERANCE_MS ||
      now - startedAt > RECENT_INVOICE_WINDOW_MS
    ) {
      storage.removeItem(key);
      return null;
    }
    return startedAt;
  } catch {
    return null;
  }
}

export function forgetRememberedSubscriptionCheckout(
  workspaceId: string,
  storage: CheckoutCorrelationStorage | null = browserSessionStorage(),
): void {
  try {
    storage?.removeItem(checkoutCorrelationKey(workspaceId));
  } catch {
    // Failing closed means no purchase event can be correlated on return.
  }
}

type Gtag = (...args: unknown[]) => void;

declare global {
  interface Window {
    dataLayer?: IArguments[];
    gtag?: Gtag;
  }
}

export interface AnalyticsRuntime {
  document: Document;
  hostname: string;
  origin: string;
  pathname: string;
  referrer: string;
  search: string;
  scope: Window;
  storage: Pick<Storage, "getItem" | "setItem">;
}

export type AnalyticsAuthState =
  | "signed_in_unverified"
  | "signed_in_verified"
  | "signed_out";

export type AccountAgeBucket =
  | "7_29d"
  | "30_89d"
  | "90_364d"
  | "365d_plus"
  | "lt_7d"
  | "unknown";

export type WorkspaceCountBucket = "0" | "1" | "2_3" | "4_plus" | "unknown";

export interface AnalyticsUserContext {
  accountAgeBucket: AccountAgeBucket;
  userId: string;
  workspaceCountBucket: WorkspaceCountBucket;
}

export interface AnalyticsPageViewContext {
  authState: AnalyticsAuthState;
  subscriptionStatus?: SubscriptionStatus;
  workspaceRole?: Role;
}

export interface SafeCampaignContext {
  campaign_content?: string;
  campaign_medium: string;
  campaign_name: string;
  campaign_source: string;
}

export interface AnalyticsItem {
  item_id: "workspace_monthly";
  item_name: "Zenguy workspace monthly";
  price: number;
  quantity: 1;
}

interface SignUpEvent {
  name: "sign_up";
  params: { method: "email" };
}

interface BeginCheckoutEvent {
  name: "begin_checkout";
  params: {
    billing_purpose: "subscription";
    currency: BillingCurrency;
    items: AnalyticsItem[];
    value: number;
  };
}

interface PurchaseEvent {
  name: "purchase";
  params: {
    billing_purpose: "subscription";
    currency: BillingCurrency;
    items: AnalyticsItem[];
    transaction_id: string;
    value: number;
  };
}

export type AllowedAnalyticsEvent =
  | SignUpEvent
  | BeginCheckoutEvent
  | PurchaseEvent;

function browserRuntime(): AnalyticsRuntime | null {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return null;
  }
  try {
    return {
      document,
      hostname: window.location.hostname,
      origin: window.location.origin,
      pathname: window.location.pathname,
      referrer: document.referrer,
      search: window.location.search,
      scope: window,
      storage: window.localStorage,
    };
  } catch {
    return null;
  }
}

const SAFE_CAMPAIGN_KEYS = new Set([
  "utm_campaign",
  "utm_content",
  "utm_medium",
  "utm_source",
]);
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
] as const);
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
] as const);
export const ANALYTICS_CAMPAIGN_NAMES = Object.freeze([
  "august_launch",
  "brand",
  "launch",
  "newsletter",
  "other",
  "product_launch",
  "q3_launch",
  "site_to_app",
] as const);
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
] as const);

export const ANALYTICS_CAMPAIGN_CATALOG = Object.freeze({
  content: ANALYTICS_CAMPAIGN_CONTENT,
  medium: ANALYTICS_CAMPAIGN_MEDIA,
  name: ANALYTICS_CAMPAIGN_NAMES,
  source: ANALYTICS_CAMPAIGN_SOURCES,
});
export const ANALYTICS_CTA_LOCATIONS = Object.freeze([
  "article_signup",
  "closing_signup",
  "hero_signup",
  "nav_signin",
  "nav_signup",
  "pricing_signup",
  "uptime_signup",
] as const);

const SAFE_CAMPAIGN_VALUE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const CAMPAIGN_TOKEN_WORD = /(?:^|[._-])(?:access[-_]?token|authorization|bearer|jwt|password|secret|token)(?:$|[._-])/;
const CAMPAIGN_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CAMPAIGN_LONG_IDENTIFIER = /^(?:[a-f0-9]{24,}|[a-z0-9]{32,}|\d{10,})$/;

type CampaignCatalog = readonly string[];

function safeCampaignValue(
  params: URLSearchParams,
  key: string,
  catalog: CampaignCatalog,
  unknown: "omit" | "other",
): string | null | undefined {
  const values = params.getAll(key);
  if (values.length !== 1) return null;
  const rawValue = values[0];
  if (rawValue === undefined) return null;
  if (rawValue.includes("@")) return null;
  const decoded = rawValue
    .normalize("NFKC")
    .trim()
    .toLowerCase();
  if (CAMPAIGN_UUID.test(decoded)) return null;
  const normalized = decoded.replace(/[\s.-]+/g, "_");
  if (
    normalized.length === 0 ||
    normalized.length > 64 ||
    !SAFE_CAMPAIGN_VALUE.test(normalized) ||
    normalized.includes("@") ||
    CAMPAIGN_TOKEN_WORD.test(normalized) ||
    CAMPAIGN_UUID.test(normalized) ||
    CAMPAIGN_LONG_IDENTIFIER.test(normalized)
  ) {
    return null;
  }
  if (catalog.includes(normalized)) return normalized;
  return unknown === "other" ? "other" : undefined;
}

/**
 * Keeps attribution while ensuring arbitrary query-string contents never
 * become GA parameters. A partial or suspicious campaign is discarded whole.
 */
export function safeCampaignContext(search: string): SafeCampaignContext | null {
  const params = new URLSearchParams(search);
  for (const [key] of params) {
    if (key.toLowerCase().startsWith("utm_") && !SAFE_CAMPAIGN_KEYS.has(key)) {
      return null;
    }
  }
  const source = safeCampaignValue(
    params,
    "utm_source",
    ANALYTICS_CAMPAIGN_SOURCES,
    "other",
  );
  const medium = safeCampaignValue(
    params,
    "utm_medium",
    ANALYTICS_CAMPAIGN_MEDIA,
    "other",
  );
  const name = safeCampaignValue(
    params,
    "utm_campaign",
    ANALYTICS_CAMPAIGN_NAMES,
    "other",
  );
  if (!source || !medium || !name) return null;

  const hasContent = params.has("utm_content");
  const content = hasContent
    ? safeCampaignValue(
        params,
        "utm_content",
        ANALYTICS_CAMPAIGN_CONTENT,
        "omit",
      )
    : undefined;
  if (content === null) return null;
  return {
    campaign_medium: medium,
    campaign_name: name,
    campaign_source: source,
    ...(content === undefined ? {} : { campaign_content: content }),
  };
}

/** The public site transports CTA placement separately from campaign creative. */
export function safeEntryCtaContext(
  search: string,
): { cta_location: (typeof ANALYTICS_CTA_LOCATIONS)[number] } | null {
  const values = new URLSearchParams(search).getAll("zg_cta");
  if (values.length !== 1) return null;
  const value = values[0];
  if (
    value === undefined ||
    !ANALYTICS_CTA_LOCATIONS.includes(
      value as (typeof ANALYTICS_CTA_LOCATIONS)[number],
    )
  ) {
    return null;
  }
  return { cta_location: value as (typeof ANALYTICS_CTA_LOCATIONS)[number] };
}

function isProductionUserId(value: string): boolean {
  return /^usr_[0-9a-hjkmnp-tv-z]{26}$/.test(value);
}

/**
 * Creates a purpose-specific, non-PII User-ID. The internal user id never
 * leaves the browser and no identifier is produced when Web Crypto is absent.
 */
export async function analyticsUserIdFor(
  internalUserId: string,
  subtle: Pick<SubtleCrypto, "digest"> | undefined = globalThis.crypto?.subtle,
): Promise<string | null> {
  if (!isProductionUserId(internalUserId) || subtle === undefined) return null;
  const input = new TextEncoder().encode(`zenguy-ga4-user-v1:${internalUserId}`);
  const digest = await subtle.digest("SHA-256", input);
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `za_${hex}`;
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMoney(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= 1_000_000
  );
}

function isAnalyticsItem(value: unknown): value is AnalyticsItem {
  if (!isRecord(value)) return false;
  return (
    exactKeys(value, ["item_id", "item_name", "price", "quantity"]) &&
    value.item_id === "workspace_monthly" &&
    value.item_name === "Zenguy workspace monthly" &&
    isMoney(value.price) &&
    value.quantity === 1
  );
}

function validSubscriptionParams(
  value: unknown,
  withTransaction: boolean,
): value is BeginCheckoutEvent["params"] | PurchaseEvent["params"] {
  if (!isRecord(value)) return false;
  const keys = ["billing_purpose", "currency", "items", "value"];
  if (withTransaction) keys.push("transaction_id");
  if (!exactKeys(value, keys)) return false;
  if (
    value.billing_purpose !== "subscription" ||
    (value.currency !== "EUR" && value.currency !== "USD") ||
    !isMoney(value.value) ||
    !Array.isArray(value.items) ||
    value.items.length !== 1 ||
    !isAnalyticsItem(value.items[0])
  ) {
    return false;
  }
  if (value.items[0].price !== value.value) return false;
  if (!withTransaction) return true;
  return (
    typeof value.transaction_id === "string" &&
    /^[A-Za-z0-9_-]{1,100}$/.test(value.transaction_id)
  );
}

/** Runtime validation prevents structurally compatible objects adding PII. */
export function isAllowedAnalyticsEvent(
  value: unknown,
): value is AllowedAnalyticsEvent {
  if (!isRecord(value) || !exactKeys(value, ["name", "params"])) return false;
  if (!isRecord(value.params)) return false;
  if (value.name === "sign_up") {
    return exactKeys(value.params, ["method"]) && value.params.method === "email";
  }
  if (value.name === "begin_checkout") {
    return validSubscriptionParams(value.params, false);
  }
  if (value.name === "purchase") {
    return validSubscriptionParams(value.params, true);
  }
  return false;
}

function subscriptionItem(price: number): AnalyticsItem {
  return {
    item_id: "workspace_monthly",
    item_name: "Zenguy workspace monthly",
    price,
    quantity: 1,
  };
}

export function subscriptionCheckoutEvent(
  price: Pick<BillingPlanPrice, "currency" | "pricePerMonthCents">,
): BeginCheckoutEvent {
  const value = price.pricePerMonthCents / 100;
  return {
    name: "begin_checkout",
    params: {
      billing_purpose: "subscription",
      currency: price.currency,
      items: [subscriptionItem(value)],
      value,
    },
  };
}

/**
 * A query-string success flag is not a purchase confirmation. A purchase is
 * built only from an active Stripe subscription and a recent paid invoice
 * returned by the authenticated billing API.
 */
export function confirmedSubscriptionPurchaseEvent(
  billing: Billing,
  checkoutStartedAt: number,
  now = Date.now(),
): PurchaseEvent | null {
  if (
    billing.subscription.status !== "ACTIVE" ||
    billing.subscription.source !== "stripe" ||
    billing.plan.pricePerMonthCents <= 0
  ) {
    return null;
  }

  const subscriptionStartedAt = billing.subscription.periodStart
    ? Date.parse(billing.subscription.periodStart)
    : NaN;
  if (
    !Number.isFinite(checkoutStartedAt) ||
    checkoutStartedAt > now + CHECKOUT_CLOCK_TOLERANCE_MS ||
    now - checkoutStartedAt > RECENT_INVOICE_WINDOW_MS ||
    !Number.isFinite(subscriptionStartedAt) ||
    subscriptionStartedAt < checkoutStartedAt - CHECKOUT_CLOCK_TOLERANCE_MS ||
    subscriptionStartedAt > now + CHECKOUT_CLOCK_TOLERANCE_MS
  ) {
    return null;
  }

  const invoice = billing.invoices
    .map((candidate) => ({
      candidate,
      billedAt: candidate.billedAt ? Date.parse(candidate.billedAt) : NaN,
    }))
    .filter(({ billedAt, candidate }) => {
    return (
      candidate.status.toLowerCase() === "paid" &&
      candidate.currency === billing.plan.currency &&
      candidate.totalCents > 0 &&
      /^[A-Za-z0-9_-]{1,100}$/.test(candidate.id) &&
      Number.isFinite(billedAt) &&
      billedAt >= checkoutStartedAt - CHECKOUT_CLOCK_TOLERANCE_MS &&
      billedAt <= now + CHECKOUT_CLOCK_TOLERANCE_MS &&
      now - billedAt <= RECENT_INVOICE_WINDOW_MS &&
      Math.abs(billedAt - subscriptionStartedAt) <= INITIAL_INVOICE_TOLERANCE_MS
    );
    })
    .sort(
      (left, right) =>
        Math.abs(left.billedAt - subscriptionStartedAt) -
        Math.abs(right.billedAt - subscriptionStartedAt),
    )[0]?.candidate;
  if (invoice === undefined) return null;

  const value = billing.plan.pricePerMonthCents / 100;
  const event: PurchaseEvent = {
    name: "purchase",
    params: {
      billing_purpose: "subscription",
      currency: billing.plan.currency,
      items: [subscriptionItem(value)],
      transaction_id: invoice.id,
      value,
    },
  };
  return isAllowedAnalyticsEvent(event) ? event : null;
}

const DENIED_CONSENT = {
  ad_personalization: "denied",
  ad_storage: "denied",
  ad_user_data: "denied",
  analytics_storage: "denied",
} as const;

const ANALYTICS_CONSENT = {
  ...DENIED_CONSENT,
  analytics_storage: "granted",
} as const;

function deleteAnalyticsCookies(documentRef: Document): void {
  for (const part of documentRef.cookie.split(";")) {
    const name = part.split("=", 1)[0]?.trim();
    if (!name?.startsWith("_ga")) continue;
    const expiry = `${name}=; Max-Age=0; Path=/; SameSite=Lax; Secure`;
    documentRef.cookie = expiry;
    documentRef.cookie = `${expiry}; Domain=app.zenguy.com`;
    documentRef.cookie = `${expiry}; Domain=.zenguy.com`;
  }
}

function safeReferrerOrigin(referrer: string): string {
  if (referrer === "") return "";
  try {
    const url = new URL(referrer);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return new URL("/", url.origin).href;
  } catch {
    return "";
  }
}

const PAGE_TITLES: Record<string, string> = {
  alerts: "Alerts",
  auth: "Account",
  billing: "Billing",
  error: "Page not found",
  incidents: "Incidents",
  legal: "Legal",
  onboarding: "Onboarding",
  overview: "Overview",
  runs: "Runs",
  security: "Secrets",
  settings: "Settings",
  status_pages: "Status pages",
  team: "Members",
  tests: "Browser tests",
  uptime: "Uptime",
};

const DEFAULT_PAGE_CONTEXT: AnalyticsPageViewContext = {
  authState: "signed_out",
};

function isPageViewContext(value: AnalyticsPageViewContext): boolean {
  const keys = Object.keys(value).sort();
  if (!keys.every((key) => ["authState", "subscriptionStatus", "workspaceRole"].includes(key))) {
    return false;
  }
  if (!["signed_in_unverified", "signed_in_verified", "signed_out"].includes(value.authState)) {
    return false;
  }
  if (
    value.workspaceRole !== undefined &&
    !["OWNER", "ADMIN", "MEMBER"].includes(value.workspaceRole)
  ) {
    return false;
  }
  return (
    value.subscriptionStatus === undefined ||
    ["NONE", "ACTIVE", "PAST_DUE", "CANCELED"].includes(value.subscriptionStatus)
  );
}

function isUserContext(value: AnalyticsUserContext): boolean {
  return (
    exactKeys(value as unknown as Record<string, unknown>, [
      "accountAgeBucket",
      "userId",
      "workspaceCountBucket",
    ]) &&
    ["lt_7d", "7_29d", "30_89d", "90_364d", "365d_plus", "unknown"].includes(
      value.accountAgeBucket,
    ) &&
    /^za_[0-9a-f]{64}$/.test(value.userId) &&
    ["0", "1", "2_3", "4_plus", "unknown"].includes(value.workspaceCountBucket)
  );
}

function analyticsUserProperties(context: AnalyticsUserContext | null) {
  return {
    account_age_bucket: context?.accountAgeBucket ?? null,
    workspace_count_bucket: context?.workspaceCountBucket ?? null,
  };
}

function safePageContext(
  runtime: AnalyticsRuntime,
  routePattern?: string,
  context: AnalyticsPageViewContext = DEFAULT_PAGE_CONTEXT,
  includeReferrer = false,
) {
  const candidate = routePattern ?? analyticsRoutePatternFor(runtime.pathname);
  const safePattern = candidate && isAnalyticsRoutePattern(candidate) ? candidate : "/404";
  const classification = analyticsClassificationFor(safePattern) ?? {
    appSection: "error" as const,
    contentGroup: "error" as const,
  };
  const authenticated = context.authState === "signed_in_verified";
  return {
    app_section: classification.appSection,
    auth_state: context.authState,
    content_group: classification.contentGroup,
    page_location: `${runtime.origin}${safePattern}`,
    page_path: safePattern,
    page_referrer: includeReferrer ? safeReferrerOrigin(runtime.referrer) : "",
    page_title: `Zenguy · ${PAGE_TITLES[classification.appSection]}`,
    route_pattern: safePattern,
    subscription_status: context.subscriptionStatus?.toLowerCase() ?? "not_applicable",
    surface: authenticated ? "web_app_authenticated" : "web_app_public",
    workspace_role: context.workspaceRole?.toLowerCase() ?? "not_applicable",
  };
}

export interface AnalyticsClient {
  grant: () => boolean;
  initialize: () => boolean;
  revoke: () => boolean;
  setUserContext: (context: AnalyticsUserContext | null) => boolean;
  track: (event: AllowedAnalyticsEvent) => boolean;
  trackPageView: (
    routePattern: string,
    context?: AnalyticsPageViewContext,
  ) => boolean;
  updatePageContext: (
    routePattern: string,
    context: AnalyticsPageViewContext,
  ) => boolean;
}

export function createAnalyticsClient(
  getRuntime: () => AnalyticsRuntime | null,
): AnalyticsClient {
  let initialized = false;
  let consentState: "denied" | "granted" | null = null;
  let documentConsentOverride: boolean | null = null;
  let currentPageContext: AnalyticsPageViewContext = DEFAULT_PAGE_CONTEXT;
  let currentUserContext: AnalyticsUserContext | null = null;
  let hasTrackedPageView = false;

  const permittedRuntime = (): AnalyticsRuntime | null => {
    const runtime = getRuntime();
    if (
      runtime === null ||
      !isAnalyticsProductionHost(runtime.hostname) ||
      runtime.origin !== "https://app.zenguy.com"
    ) {
      return null;
    }
    const analyticsAllowed =
      documentConsentOverride ??
      (readCookieConsent(runtime.storage)?.analytics === true);
    return analyticsAllowed ? runtime : null;
  };

  const initialize = (): boolean => {
    const runtime = permittedRuntime();
    if (runtime === null) return false;

    if (initialized && runtime.scope.gtag) {
      if (consentState !== "granted") {
        runtime.scope.gtag("consent", "update", ANALYTICS_CONSENT);
        consentState = "granted";
      }
      return true;
    }

    runtime.scope.dataLayer = runtime.scope.dataLayer ?? [];
    runtime.scope.gtag = function gtag(..._args: unknown[]) {
      runtime.scope.dataLayer?.push(arguments);
    };

    // Basic Consent Mode: this queue and the Google script are created only
    // after an affirmative choice. Default is still sent before the update.
    runtime.scope.gtag("consent", "default", DENIED_CONSENT);
    runtime.scope.gtag("consent", "update", ANALYTICS_CONSENT);
    runtime.scope.gtag("set", "ads_data_redaction", true);
    runtime.scope.gtag("js", new Date());
    const initialPage = safePageContext(
      runtime,
      undefined,
      currentPageContext,
      true,
    );
    runtime.scope.gtag(
      "set",
      "user_properties",
      analyticsUserProperties(currentUserContext),
    );
    runtime.scope.gtag("config", GA4_MEASUREMENT_ID, {
      allow_ad_personalization_signals: false,
      allow_google_signals: false,
      cookie_domain: "none",
      ...initialPage,
      ...(safeCampaignContext(runtime.search) ?? {}),
      ...(safeEntryCtaContext(runtime.search) ?? {}),
      send_page_view: false,
      user_id: currentUserContext?.userId ?? null,
    });

    if (runtime.document.getElementById(GA4_SCRIPT_ID) === null) {
      const script = runtime.document.createElement("script");
      script.async = true;
      script.id = GA4_SCRIPT_ID;
      script.src = GA4_SCRIPT_URL;
      runtime.document.head.appendChild(script);
    }
    initialized = true;
    consentState = "granted";
    return true;
  };

  const track = (event: AllowedAnalyticsEvent): boolean => {
    if (!isAllowedAnalyticsEvent(event) || !initialize()) return false;
    const runtime = permittedRuntime();
    if (!runtime?.scope.gtag) return false;
    runtime.scope.gtag("event", event.name, {
      ...event.params,
      ...safePageContext(runtime, undefined, currentPageContext),
    });
    return true;
  };

  return {
    grant: () => {
      documentConsentOverride = true;
      return initialize();
    },
    initialize,
    revoke: () => {
      const runtime = getRuntime();
      if (
        runtime === null ||
        !isAnalyticsProductionHost(runtime.hostname) ||
        runtime.origin !== "https://app.zenguy.com"
      ) {
        return false;
      }
      documentConsentOverride = false;
      const needsReload = initialized;
      if (initialized && runtime.scope.gtag && consentState === "granted") {
        runtime.scope.gtag("consent", "update", DENIED_CONSENT);
      }
      consentState = "denied";
      deleteAnalyticsCookies(runtime.document);
      return needsReload;
    },
    setUserContext: (context) => {
      if (context !== null && !isUserContext(context)) return false;
      currentUserContext = context;
      const runtime = permittedRuntime();
      if (runtime === null) return false;
      if (!initialized || !runtime.scope.gtag) return true;
      runtime.scope.gtag(
        "set",
        "user_properties",
        analyticsUserProperties(currentUserContext),
      );
      runtime.scope.gtag("config", GA4_MEASUREMENT_ID, {
        send_page_view: false,
        update: true,
        user_id: currentUserContext?.userId ?? null,
      });
      return true;
    },
    track,
    trackPageView: (routePattern, context = DEFAULT_PAGE_CONTEXT) => {
      if (
        !isAnalyticsRoutePattern(routePattern) ||
        !isPageViewContext(context)
      ) {
        return false;
      }
      currentPageContext = context;
      if (!initialize()) return false;
      const runtime = permittedRuntime();
      if (!runtime?.scope.gtag) return false;
      const page = safePageContext(
        runtime,
        routePattern,
        context,
        !hasTrackedPageView,
      );
      // `update` is the documented SPA mechanism for making subsequent
      // automatic engagement events inherit the new sanitized page context.
      runtime.scope.gtag("config", GA4_MEASUREMENT_ID, {
        ...page,
        send_page_view: false,
        update: true,
      });
      runtime.scope.gtag("event", "page_view", page);
      hasTrackedPageView = true;
      return true;
    },
    updatePageContext: (routePattern, context) => {
      if (
        !isAnalyticsRoutePattern(routePattern) ||
        !isPageViewContext(context)
      ) {
        return false;
      }
      currentPageContext = context;
      if (!initialize()) return false;
      const runtime = permittedRuntime();
      if (!runtime?.scope.gtag) return false;
      runtime.scope.gtag("config", GA4_MEASUREMENT_ID, {
        ...safePageContext(runtime, routePattern, context),
        send_page_view: false,
        update: true,
      });
      return true;
    },
  };
}

const analyticsClient = createAnalyticsClient(browserRuntime);

export function initializeAnalytics(): boolean {
  try {
    return analyticsClient.initialize();
  } catch {
    return false;
  }
}

export function grantAnalyticsConsent(): boolean {
  try {
    return analyticsClient.grant();
  } catch {
    return false;
  }
}

export function revokeAnalytics(): boolean {
  try {
    return analyticsClient.revoke();
  } catch {
    return false;
  }
}

export function trackAnalyticsPageView(routePattern: string): boolean {
  return trackAnalyticsPageViewWithContext(routePattern, DEFAULT_PAGE_CONTEXT);
}

export function trackAnalyticsPageViewWithContext(
  routePattern: string,
  context: AnalyticsPageViewContext,
): boolean {
  try {
    return analyticsClient.trackPageView(routePattern, context);
  } catch {
    return false;
  }
}

export function setAnalyticsUserContext(
  context: AnalyticsUserContext | null,
): boolean {
  try {
    return analyticsClient.setUserContext(context);
  } catch {
    return false;
  }
}

export function updateAnalyticsPageContext(
  routePattern: string,
  context: AnalyticsPageViewContext,
): boolean {
  try {
    return analyticsClient.updatePageContext(routePattern, context);
  } catch {
    return false;
  }
}

export function accountAgeBucketFor(
  createdAt: string,
  now = Date.now(),
): AccountAgeBucket | null {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created) || !Number.isFinite(now) || created > now) {
    return null;
  }
  const days = (now - created) / (24 * 60 * 60 * 1_000);
  if (days < 7) return "lt_7d";
  if (days < 30) return "7_29d";
  if (days < 90) return "30_89d";
  if (days < 365) return "90_364d";
  return "365d_plus";
}

export function workspaceCountBucketFor(count: number): WorkspaceCountBucket | null {
  if (!Number.isInteger(count) || count < 0) return null;
  if (count === 0) return "0";
  if (count === 1) return "1";
  if (count <= 3) return "2_3";
  return "4_plus";
}

interface VerifiedSignUpAnalytics {
  setUserContext: AnalyticsClient["setUserContext"];
  track: AnalyticsClient["track"];
  updatePageContext: AnalyticsClient["updatePageContext"];
}

/**
 * Verification tokens are single-use on the server. This document-local set
 * additionally closes the only realistic client race without persisting a raw
 * account id, email, verification token or any new browser-storage marker.
 */
export function createVerifiedSignUpTracker(
  analytics: VerifiedSignUpAnalytics,
  deriveUserId: (internalUserId: string) => Promise<string | null> =
    analyticsUserIdFor,
): (user: Pick<User, "createdAt" | "emailVerified" | "id">) => Promise<boolean> {
  const claimedUserIds = new Set<string>();

  return async (user) => {
    if (!user.emailVerified) return false;
    const userId = await deriveUserId(user.id);
    if (userId === null || claimedUserIds.has(userId)) return false;
    claimedUserIds.add(userId);

    try {
      const identified = analytics.setUserContext({
        accountAgeBucket: accountAgeBucketFor(user.createdAt) ?? "unknown",
        userId,
        workspaceCountBucket: "unknown",
      });
      const contextualized =
        identified &&
        analytics.updatePageContext("/verify-email", {
          authState: "signed_in_verified",
        });
      const tracked =
        contextualized &&
        analytics.track({ name: "sign_up", params: { method: "email" } });
      if (!tracked) claimedUserIds.delete(userId);
      return tracked;
    } catch {
      claimedUserIds.delete(userId);
      return false;
    }
  };
}

const trackVerifiedSignUp = createVerifiedSignUpTracker(analyticsClient);

export function trackVerifiedSignUpSuccess(
  user: Pick<User, "createdAt" | "emailVerified" | "id">,
): Promise<boolean> {
  return trackVerifiedSignUp(user);
}

export function trackSubscriptionCheckoutStarted(
  price: Pick<BillingPlanPrice, "currency" | "pricePerMonthCents">,
): boolean {
  try {
    return analyticsClient.track(subscriptionCheckoutEvent(price));
  } catch {
    return false;
  }
}

export function trackConfirmedSubscriptionPurchase(
  billing: Billing,
  checkoutStartedAt: number,
): boolean {
  try {
    const event = confirmedSubscriptionPurchaseEvent(
      billing,
      checkoutStartedAt,
    );
    return event === null ? false : analyticsClient.track(event);
  } catch {
    return false;
  }
}
