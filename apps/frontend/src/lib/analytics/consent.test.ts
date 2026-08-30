import { describe, expect, it } from "vitest";

import {
  COOKIE_CONSENT_MAX_AGE_MS,
  COOKIE_CONSENT_STORAGE_KEY,
  isCookieConsentPersisted,
  isAnalyticsProductionHost,
  parseCookieConsent,
  readCookieConsent,
  writeCookieConsent,
} from "./consent";

function memoryStorage(): Pick<Storage, "getItem" | "removeItem" | "setItem"> & {
  values: Map<string, string>;
} {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
    values,
  };
}

describe("analytics cookie consent", () => {
  const now = Date.parse("2026-08-30T12:00:00.000Z");

  it("uses the shared, versioned schema", () => {
    const storage = memoryStorage();
    const record = writeCookieConsent(
      true,
      storage,
      new Date("2026-08-30T12:00:00.000Z"),
    );

    expect(storage.values.get(COOKIE_CONSENT_STORAGE_KEY)).toBe(
      JSON.stringify({
        analytics: true,
        updatedAt: "2026-08-30T12:00:00.000Z",
        version: 2,
      }),
    );
    expect(readCookieConsent(storage, now)).toEqual(record);
    expect(isCookieConsentPersisted(record, storage)).toBe(true);
  });

  it("fails closed when a consent choice cannot replace stored consent", () => {
    const existing = JSON.stringify({
      analytics: true,
      updatedAt: "2026-08-30T11:00:00.000Z",
      version: 2,
    });
    const blocked = {
      getItem: () => existing,
      setItem: () => {
        throw new Error("storage blocked");
      },
    };
    const rejected = writeCookieConsent(
      false,
      blocked,
      new Date("2026-08-30T12:00:00.000Z"),
    );
    expect(isCookieConsentPersisted(rejected, blocked)).toBe(false);
  });

  it("uses a session override when durable consent storage is blocked", () => {
    const existing = JSON.stringify({
      analytics: true,
      updatedAt: "2026-08-30T11:00:00.000Z",
      version: 2,
    });
    const blocked = {
      getItem: () => existing,
      setItem: () => {
        throw new Error("storage blocked");
      },
    };
    const session = memoryStorage();
    const rejected = writeCookieConsent(
      false,
      blocked,
      new Date("2026-08-30T12:00:00.000Z"),
      session,
    );
    expect(isCookieConsentPersisted(rejected, blocked, session)).toBe(true);
    expect(readCookieConsent(blocked, now, session)?.analytics).toBe(false);
  });

  it("rejects malformed, future, wrong-version and expired choices", () => {
    expect(parseCookieConsent("not-json", now)).toBeNull();
    expect(
      parseCookieConsent(
        JSON.stringify({
          analytics: true,
          email: "person@example.com",
          updatedAt: "2026-08-30T12:00:00.000Z",
          version: 2,
        }),
        now,
      ),
    ).toBeNull();
    expect(
      parseCookieConsent(
        JSON.stringify({ analytics: true, updatedAt: "2026-08-30T12:00:00.000Z", version: 1 }),
        now,
      ),
    ).toBeNull();
    expect(
      parseCookieConsent(
        JSON.stringify({ analytics: true, updatedAt: "2026-08-30T12:06:00.000Z", version: 2 }),
        now,
      ),
    ).toBeNull();
    expect(
      parseCookieConsent(
        JSON.stringify({
          analytics: false,
          updatedAt: new Date(now - COOKIE_CONSENT_MAX_AGE_MS).toISOString(),
          version: 2,
        }),
        now,
      ),
    ).toBeNull();
  });

  it("enables analytics only on the exact production app host", () => {
    expect(isAnalyticsProductionHost("app.zenguy.com")).toBe(true);
    expect(isAnalyticsProductionHost("app.zenguy.com", "http:", "")).toBe(false);
    expect(isAnalyticsProductionHost("app.zenguy.com", "https:", "4173")).toBe(false);
    for (const host of [
      "localhost",
      "staging-app.zenguy.com",
      "preview.zenguy.com",
      "app.zenguy.com.example.test",
      "zenguy.com",
    ]) {
      expect(isAnalyticsProductionHost(host)).toBe(false);
    }
  });
});
