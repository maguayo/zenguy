export const COOKIE_CONSENT_STORAGE_KEY = "zenguy:cookie-consent:v1";
const COOKIE_CONSENT_SESSION_OVERRIDE_KEY =
  "zenguy:cookie-consent-session-override:v1";
// Version 2 adds the disclosed, purpose-specific pseudonymous User-ID and
// finite account/workspace reporting categories. Version 1 consent must not be
// reused for that expanded processing.
export const COOKIE_CONSENT_VERSION = 2 as const;

// AEPD recommends renewing cookie consent no later than every 24 months.
export const COOKIE_CONSENT_MAX_AGE_MS = 730 * 24 * 60 * 60 * 1_000;

export interface CookieConsentRecord {
  analytics: boolean;
  updatedAt: string;
  version: typeof COOKIE_CONSENT_VERSION;
}

type ConsentStorage = Pick<Storage, "getItem" | "setItem"> &
  Partial<Pick<Storage, "removeItem">>;

function browserStorage(): ConsentStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function browserSessionStorage(): ConsentStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function clearCookieConsentSessionOverride(
  sessionStorage: ConsentStorage | null = browserSessionStorage(),
): void {
  try {
    sessionStorage?.removeItem?.(COOKIE_CONSENT_SESSION_OVERRIDE_KEY);
  } catch {
    // The explicit in-memory document override still fails closed.
  }
}

export function isAnalyticsProductionHost(
  hostname?: string,
  protocol?: string,
  port?: string,
): boolean {
  const hasBrowser = typeof window !== "undefined";
  const currentHostname = hostname ?? (hasBrowser ? window.location.hostname : "");
  const currentProtocol = protocol ?? (hostname === undefined && hasBrowser ? window.location.protocol : "https:");
  const currentPort = port ?? (hostname === undefined && hasBrowser ? window.location.port : "");
  return (
    currentHostname === "app.zenguy.com" &&
    currentProtocol === "https:" &&
    currentPort === ""
  );
}

export function parseCookieConsent(
  serialized: string | null,
  now = Date.now(),
): CookieConsentRecord | null {
  if (serialized === null) return null;
  try {
    const value: unknown = JSON.parse(serialized);
    if (typeof value !== "object" || value === null) return null;
    const candidate = value as Record<string, unknown>;
    if (Object.keys(candidate).sort().join(",") !== "analytics,updatedAt,version") {
      return null;
    }
    if (
      candidate.version !== COOKIE_CONSENT_VERSION ||
      typeof candidate.analytics !== "boolean" ||
      typeof candidate.updatedAt !== "string"
    ) {
      return null;
    }
    const updatedAt = Date.parse(candidate.updatedAt);
    if (!Number.isFinite(updatedAt)) return null;
    // Invalid clocks must not create effectively permanent consent.
    if (updatedAt > now + 5 * 60 * 1_000) return null;
    if (now - updatedAt >= COOKIE_CONSENT_MAX_AGE_MS) return null;
    return {
      analytics: candidate.analytics,
      updatedAt: candidate.updatedAt,
      version: COOKIE_CONSENT_VERSION,
    };
  } catch {
    return null;
  }
}

export function readCookieConsent(
  storage: ConsentStorage | null = browserStorage(),
  now = Date.now(),
  sessionStorage: ConsentStorage | null = browserSessionStorage(),
): CookieConsentRecord | null {
  try {
    const sessionRecord = parseCookieConsent(
      sessionStorage?.getItem(COOKIE_CONSENT_SESSION_OVERRIDE_KEY) ?? null,
      now,
    );
    if (sessionRecord !== null) return sessionRecord;
  } catch {
    // Fall through to durable storage.
  }
  if (storage === null) return null;
  try {
    return parseCookieConsent(
      storage.getItem(COOKIE_CONSENT_STORAGE_KEY),
      now,
    );
  } catch {
    return null;
  }
}

export function writeCookieConsent(
  analytics: boolean,
  storage: ConsentStorage | null = browserStorage(),
  updatedAt = new Date(),
  sessionStorage: ConsentStorage | null = browserSessionStorage(),
): CookieConsentRecord {
  const record: CookieConsentRecord = {
    analytics,
    updatedAt: updatedAt.toISOString(),
    version: COOKIE_CONSENT_VERSION,
  };
  const serialized = JSON.stringify(record);
  let durablyPersisted = false;
  try {
    storage?.setItem(COOKIE_CONSENT_STORAGE_KEY, serialized);
    durablyPersisted =
      storage?.getItem(COOKIE_CONSENT_STORAGE_KEY) === serialized;
  } catch {
    durablyPersisted = false;
  }
  if (durablyPersisted) {
    clearCookieConsentSessionOverride(sessionStorage);
  } else {
    try {
      sessionStorage?.setItem(
        COOKIE_CONSENT_SESSION_OVERRIDE_KEY,
        serialized,
      );
    } catch {
      // Callers verify persistence before loading Analytics or reloading.
    }
  }
  return record;
}

export function isCookieConsentPersisted(
  record: CookieConsentRecord,
  storage: ConsentStorage | null = browserStorage(),
  sessionStorage: ConsentStorage | null = browserSessionStorage(),
): boolean {
  const stored = readCookieConsent(
    storage,
    Date.parse(record.updatedAt),
    sessionStorage,
  );
  return (
    stored?.analytics === record.analytics &&
    stored.updatedAt === record.updatedAt &&
    stored.version === record.version
  );
}
