import {
  ANALYTICS_CAMPAIGN_SESSION_KEY,
  CONSENT_KEY,
  CONSENT_VERSION,
  GA_COOKIE_DOMAIN,
  MEASUREMENT_ID,
  buildTrackedAppHref,
  cleanPageLocation,
  isAnalyticsProductionLocation,
  isAllowedAnalyticsCtaDestination,
  isAllowedAnalyticsCtaLocation,
  isConsentRecord,
  isSafeCampaign,
  parseSafeCampaign,
  publicPageAnalyticsContext,
  resolveSafeCampaign,
} from "./analytics-config.mjs";

const GOOGLE_TAG_ID = "zenguy-google-tag";
const CONSENT_SESSION_OVERRIDE_KEY =
  "zenguy:cookie-consent-session-override:v1";

type ConsentRecord = {
  version: 2;
  analytics: boolean;
  updatedAt: string;
};

type SafeCampaign = NonNullable<ReturnType<typeof parseSafeCampaign>>;

type Gtag = (...args: unknown[]) => void;
type AnalyticsWindow = Window & {
  dataLayer?: unknown[];
  gtag?: Gtag;
};

const analyticsWindow = window as AnalyticsWindow;
let analyticsStarted = false;
let currentConsent: ConsentRecord | null = null;
const banner = document.querySelector<HTMLElement>("[data-consent-banner]");
const configuredPagePath = banner?.dataset.analyticsPagePath ?? "/";
const pageAnalyticsContext = publicPageAnalyticsContext(configuredPagePath);

function isProductionHost(): boolean {
  return isAnalyticsProductionLocation(window.location);
}

function readConsent(): ConsentRecord | null {
  try {
    const sessionStored = window.sessionStorage.getItem(
      CONSENT_SESSION_OVERRIDE_KEY,
    );
    if (sessionStored !== null) {
      const parsed: unknown = JSON.parse(sessionStored);
      if (isConsentRecord(parsed)) return parsed as ConsentRecord;
      window.sessionStorage.removeItem(CONSENT_SESSION_OVERRIDE_KEY);
    }
  } catch {
    // Durable storage may still be available.
  }
  try {
    const stored = window.localStorage.getItem(CONSENT_KEY);
    if (stored === null) return null;
    const parsed: unknown = JSON.parse(stored);
    if (isConsentRecord(parsed)) return parsed as ConsentRecord;
    window.localStorage.removeItem(CONSENT_KEY);
    removeAnalyticsCookies();
  } catch {
    // Storage can be unavailable in strict browser modes. In that case the
    // choice applies to this document only and the banner returns next visit.
  }
  return null;
}

function writeConsent(analytics: boolean): {
  persisted: boolean;
  record: ConsentRecord;
} {
  const record: ConsentRecord = {
    version: CONSENT_VERSION,
    analytics,
    updatedAt: new Date().toISOString(),
  };
  currentConsent = record;
  const serialized = JSON.stringify(record);
  let persisted = false;
  try {
    window.localStorage.setItem(CONSENT_KEY, serialized);
    persisted = window.localStorage.getItem(CONSENT_KEY) === serialized;
  } catch {
    persisted = false;
  }
  if (persisted) {
    try {
      window.sessionStorage.removeItem(CONSENT_SESSION_OVERRIDE_KEY);
      const remaining = window.sessionStorage.getItem(
        CONSENT_SESSION_OVERRIDE_KEY,
      );
      if (remaining !== null) {
        window.sessionStorage.setItem(
          CONSENT_SESSION_OVERRIDE_KEY,
          serialized,
        );
        persisted =
          window.sessionStorage.getItem(CONSENT_SESSION_OVERRIDE_KEY) ===
          serialized;
      }
    } catch {
      // Durable local storage was already verified. If session storage is
      // inaccessible, readConsent also falls through to that durable value.
    }
  }
  if (!persisted) {
    try {
      window.sessionStorage.setItem(CONSENT_SESSION_OVERRIDE_KEY, serialized);
      persisted =
        window.sessionStorage.getItem(CONSENT_SESSION_OVERRIDE_KEY) ===
        serialized;
    } catch {
      // The in-memory choice still controls this document when storage is denied.
    }
  }
  return { persisted, record };
}

function normalizedPageLocation(): string {
  return cleanPageLocation({
    origin: window.location.origin,
    pathname: configuredPagePath,
  });
}

function normalizedReferrer(): string {
  if (document.referrer === "") return "";
  try {
    const referrer = new URL(document.referrer);
    // The origin retains acquisition value without exposing a third-party path.
    return new URL("/", referrer.origin).href;
  } catch {
    return "";
  }
}

function readStoredCampaign(): SafeCampaign | null {
  if (currentConsent?.analytics !== true) return null;
  try {
    const stored = window.sessionStorage.getItem(
      ANALYTICS_CAMPAIGN_SESSION_KEY,
    );
    if (stored === null) return null;
    const parsed: unknown = JSON.parse(stored);
    if (isSafeCampaign(parsed)) return parsed as SafeCampaign;
    window.sessionStorage.removeItem(ANALYTICS_CAMPAIGN_SESSION_KEY);
  } catch {
    // Attribution is optional; storage failures never weaken consent handling.
  }
  return null;
}

function writeStoredCampaign(campaign: SafeCampaign): void {
  if (currentConsent?.analytics !== true || !isSafeCampaign(campaign)) return;
  try {
    window.sessionStorage.setItem(
      ANALYTICS_CAMPAIGN_SESSION_KEY,
      JSON.stringify(campaign),
    );
  } catch {
    // The validated in-memory campaign still applies to this document.
  }
}

function clearStoredCampaign(): void {
  try {
    window.sessionStorage.removeItem(ANALYTICS_CAMPAIGN_SESSION_KEY);
  } catch {
    // Nothing else is required when browser storage is unavailable.
  }
}

function resolveConsentedCampaign(): SafeCampaign | null {
  if (currentConsent?.analytics !== true) return null;
  const resolution = resolveSafeCampaign(
    new URLSearchParams(window.location.search),
    readStoredCampaign(),
  );
  if (resolution.source === "url" && resolution.campaign !== null) {
    writeStoredCampaign(resolution.campaign);
  } else if (resolution.source === "invalid_url") {
    clearStoredCampaign();
  }
  return resolution.campaign;
}

function initializeGtag(): Gtag {
  analyticsWindow.dataLayer = analyticsWindow.dataLayer ?? [];
  analyticsWindow.gtag = function gtag() {
    analyticsWindow.dataLayer?.push(arguments);
  };
  return analyticsWindow.gtag;
}

function startAnalytics(): void {
  if (!isProductionHost()) return;
  const campaign = resolveConsentedCampaign();
  decorateAppLinks(campaign);
  if (analyticsStarted) {
    const gtag = initializeGtag();
    gtag("consent", "update", {
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      analytics_storage: "granted",
    });
    return;
  }
  analyticsStarted = true;

  const gtag = initializeGtag();
  const denied = {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "denied",
  } as const;
  const pageLocation = normalizedPageLocation();
  const pageReferrer = normalizedReferrer();
  const analyticsParameters = {
    ...pageAnalyticsContext,
    ...(campaign ?? {}),
  };

  // Basic Consent Mode: these commands are created only after an affirmative
  // choice. Nothing from Google is loaded and no consent ping is sent before it.
  gtag("consent", "default", denied);
  gtag("consent", "update", { ...denied, analytics_storage: "granted" });
  gtag("js", new Date());
  gtag("set", analyticsParameters);
  gtag("config", MEASUREMENT_ID, {
    allow_ad_personalization_signals: false,
    allow_google_signals: false,
    cookie_domain: GA_COOKIE_DOMAIN,
    page_location: pageLocation,
    page_referrer: pageReferrer,
    send_page_view: false,
    ...analyticsParameters,
  });
  gtag("event", "page_view", {
    page_location: pageLocation,
    page_path: configuredPagePath,
    page_referrer: pageReferrer,
    page_title: document.title,
    ...analyticsParameters,
  });

  const script = document.createElement("script");
  script.id = GOOGLE_TAG_ID;
  script.async = true;
  script.referrerPolicy = "no-referrer";
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(MEASUREMENT_ID)}`;
  document.head.append(script);
}

function expireCookie(name: string, domain?: string): void {
  const domainPart = domain ? `; Domain=${domain}` : "";
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax${domainPart}`;
}

function removeAnalyticsCookies(): void {
  const names = document.cookie
    .split(";")
    .map((cookie) => cookie.trim().split("=")[0] ?? "")
    .filter((name) => name === "_ga" || name.startsWith("_ga_"));

  for (const name of names) {
    expireCookie(name);
    expireCookie(name, "zenguy.com");
    expireCookie(name, ".zenguy.com");
    expireCookie(name, window.location.hostname);
  }
}

function revokeAnalytics(): void {
  if (analyticsWindow.gtag) {
    analyticsWindow.gtag("consent", "update", {
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      analytics_storage: "denied",
    });
  }
  clearStoredCampaign();
  removeAnalyticsCookies();
  decorateAppLinks(null);
}

function decorateAppLinks(campaign: SafeCampaign | null): void {
  document
    .querySelectorAll<HTMLAnchorElement>(
      "a[data-analytics-cta][data-analytics-destination]",
    )
    .forEach((anchor) => {
      const ctaLocation = anchor.dataset.analyticsCta;
      const ctaDestination = anchor.dataset.analyticsDestination;
      if (!ctaLocation || !ctaDestination) return;

      const trackedHref = buildTrackedAppHref(
        anchor.href,
        campaign,
        ctaLocation,
        ctaDestination,
      );
      if (trackedHref !== null) anchor.href = trackedHref;
    });
}

function trackCtaClick(event: MouseEvent): void {
  if (
    !analyticsStarted ||
    currentConsent?.analytics !== true ||
    !analyticsWindow.gtag ||
    !(event.target instanceof Element)
  ) {
    return;
  }

  const anchor = event.target.closest<HTMLAnchorElement>(
    "a[data-analytics-cta][data-analytics-destination]",
  );
  if (!anchor) return;

  const ctaLocation = anchor.dataset.analyticsCta;
  const ctaDestination = anchor.dataset.analyticsDestination;
  if (
    !isAllowedAnalyticsCtaLocation(ctaLocation) ||
    !isAllowedAnalyticsCtaDestination(ctaDestination)
  ) {
    return;
  }

  const approvedHref = buildTrackedAppHref(
    anchor.href,
    resolveConsentedCampaign(),
    ctaLocation,
    ctaDestination,
  );
  if (approvedHref === null) return;

  analyticsWindow.gtag("event", "cta_click", {
    cta_location: ctaLocation,
    cta_destination: ctaDestination,
    ...pageAnalyticsContext,
  });
}

const dialog = document.querySelector<HTMLDialogElement>("[data-consent-dialog]");
const form = document.querySelector<HTMLFormElement>("[data-consent-form]");
const analyticsChoice = document.querySelector<HTMLInputElement>("[data-consent-analytics]");
const status = document.querySelector<HTMLElement>("[data-consent-status]");

function closeDialog(): void {
  if (!dialog) return;
  if (typeof dialog.close === "function" && dialog.open) dialog.close();
  else dialog.removeAttribute("open");
}

function openDialog(event?: Event): void {
  event?.preventDefault();
  if (!dialog || !analyticsChoice) return;
  analyticsChoice.checked = currentConsent?.analytics ?? false;
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function announce(message: string): void {
  if (status) status.textContent = message;
}

function saveChoice(analytics: boolean): void {
  const wasEnabled = currentConsent?.analytics === true || analyticsStarted;
  const { persisted } = writeConsent(analytics);
  banner?.setAttribute("hidden", "");
  closeDialog();

  if (analytics) {
    startAnalytics();
    announce("Analytics accepted.");
    return;
  }

  revokeAnalytics();
  announce("Analytics rejected.");
  if (wasEnabled && persisted && isProductionHost()) window.location.reload();
}

function syncStoredChoice(event: StorageEvent): void {
  if (event.key !== CONSENT_KEY && event.key !== null) return;

  const wasStarted = analyticsStarted;
  try {
    window.sessionStorage.removeItem(CONSENT_SESSION_OVERRIDE_KEY);
  } catch {
    // The in-memory state below still follows the cross-tab choice.
  }
  if (event.key === null || event.newValue === null) {
    currentConsent = null;
  } else {
    try {
      const parsed: unknown = JSON.parse(event.newValue);
      currentConsent = isConsentRecord(parsed)
        ? (parsed as ConsentRecord)
        : null;
    } catch {
      currentConsent = null;
    }
  }
  if (currentConsent?.analytics === true) {
    banner?.setAttribute("hidden", "");
    startAnalytics();
    return;
  }

  revokeAnalytics();
  if (wasStarted) {
    // Reload into a clean document so no automatic engagement or scroll event
    // can be emitted from a tag initialized by the previous tab state.
    window.location.reload();
    return;
  }

  if (analyticsChoice) analyticsChoice.checked = false;
  if (currentConsent === null) banner?.removeAttribute("hidden");
  else banner?.setAttribute("hidden", "");
}

if (!isProductionHost()) {
  clearStoredCampaign();
  banner?.remove();
  dialog?.remove();
  status?.remove();
  document.querySelectorAll<HTMLElement>("[data-cookie-preferences]").forEach((control) => {
    control.setAttribute("hidden", "");
  });
} else {
  document.addEventListener("click", trackCtaClick);
  document.querySelector<HTMLElement>("[data-consent-accept]")?.addEventListener("click", () => {
    saveChoice(true);
  });
  document.querySelector<HTMLElement>("[data-consent-reject]")?.addEventListener("click", () => {
    saveChoice(false);
  });
  document.querySelectorAll<HTMLElement>("[data-cookie-preferences]").forEach((control) => {
    control.addEventListener("click", openDialog);
  });
  document.querySelectorAll<HTMLElement>("[data-consent-dialog-close]").forEach((control) => {
    control.addEventListener("click", closeDialog);
  });
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    saveChoice(analyticsChoice?.checked === true);
  });

  currentConsent = readConsent();
  if (currentConsent === null) {
    clearStoredCampaign();
    decorateAppLinks(null);
    banner?.removeAttribute("hidden");
  } else if (currentConsent.analytics) {
    startAnalytics();
  } else {
    clearStoredCampaign();
    decorateAppLinks(null);
  }

  window.addEventListener("storage", syncStoredChoice);

  if (window.location.hash === "#cookie-preferences") openDialog();
}
