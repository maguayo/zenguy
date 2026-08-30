import { describe, expect, it, vi } from "vitest";

import type { Billing } from "../../api/types";
import { writeCookieConsent } from "./consent";
import {
  ANALYTICS_CAMPAIGN_CATALOG,
  ANALYTICS_CTA_LOCATIONS,
  GA4_MEASUREMENT_ID,
  GA4_SCRIPT_URL,
  accountAgeBucketFor,
  analyticsUserIdFor,
  confirmedSubscriptionPurchaseEvent,
  createAnalyticsClient,
  createVerifiedSignUpTracker,
  forgetRememberedSubscriptionCheckout,
  rememberSubscriptionCheckout,
  isAllowedAnalyticsEvent,
  subscriptionCheckoutEvent,
  readRememberedSubscriptionCheckout,
  safeCampaignContext,
  safeEntryCtaContext,
  type AnalyticsRuntime,
  workspaceCountBucketFor,
} from "./ga4";

const EUR_PRICE = { currency: "EUR" as const, pricePerMonthCents: 3_900 };
const USD_PRICE = { currency: "USD" as const, pricePerMonthCents: 3_900 };

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

function checkoutStorage(): Pick<Storage, "getItem" | "removeItem" | "setItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

function fakeRuntime({
  consent,
  hostname = "app.zenguy.com",
}: {
  consent: boolean | null;
  hostname?: string;
}) {
  const storage = memoryStorage();
  if (consent !== null) {
    writeCookieConsent(
      consent,
      storage,
      new Date("2026-08-30T12:00:00.000Z"),
    );
  }
  const appended: Array<{ async?: boolean; id?: string; src?: string }> = [];
  const scope = {} as Window;
  const documentRef = {
    cookie: "",
    createElement: vi.fn(() => ({})),
    getElementById: vi.fn(() => null),
    head: {
      appendChild: vi.fn((script) => {
        appended.push(script);
        return script;
      }),
    },
  } as unknown as Document;
  const runtime: AnalyticsRuntime = {
    document: documentRef,
    hostname,
    origin: `https://${hostname}`,
    pathname: "/signup",
    referrer: "",
    search: "",
    scope,
    storage,
  };
  return { appended, runtime, scope };
}

function commands(scope: Window): unknown[][] {
  return (scope.dataLayer ?? []).map((entry) => Array.from(entry));
}

function activeBilling(overrides: Partial<Billing> = {}): Billing {
  return {
    invoices: [
      {
        billedAt: "2026-08-30T11:55:00.000Z",
        currency: "EUR",
        id: "in_123",
        invoiceNumber: "INV-123",
        status: "paid",
        totalCents: 4_719,
      },
    ],
    plan: {
      currency: "EUR",
      includedRuns: 300,
      overagePerRunCents: 20,
      pricePerMonthCents: 3_900,
    },
    subscription: {
      cancelAtPeriodEnd: false,
      cancelUrl: null,
      periodEnd: null,
      periodStart: "2026-08-30T11:54:00.000Z",
      source: "stripe",
      status: "ACTIVE",
      updatePaymentMethodUrl: null,
    },
    usage: {
      billableRuns: 0,
      currency: "EUR",
      includedRuns: 300,
      overageAmountCents: 0,
      overageRuns: 0,
      periodEnd: "2026-09-30T00:00:00.000Z",
      periodStart: "2026-08-30T00:00:00.000Z",
      projectedTotalCents: 3_900,
      remainingRuns: 300,
    },
    ...overrides,
  };
}

describe("GA4 basic consent client", () => {
  it("does not create a data layer or load Google without affirmative consent", () => {
    for (const consent of [null, false] as const) {
      const { appended, runtime, scope } = fakeRuntime({ consent });
      const client = createAnalyticsClient(() => runtime);
      expect(client.initialize()).toBe(false);
      expect(client.trackPageView("/signup")).toBe(false);
      expect(scope.dataLayer).toBeUndefined();
      expect(appended).toHaveLength(0);
    }
  });

  it("never loads on staging, previews, localhost or sibling domains", () => {
    for (const hostname of [
      "localhost",
      "staging-app.zenguy.com",
      "preview.pages.dev",
      "zenguy.com",
    ]) {
      const { appended, runtime, scope } = fakeRuntime({ consent: true, hostname });
      expect(createAnalyticsClient(() => runtime).initialize()).toBe(false);
      expect(scope.dataLayer).toBeUndefined();
      expect(appended).toHaveLength(0);
    }
    const insecure = fakeRuntime({ consent: true });
    insecure.runtime.origin = "http://app.zenguy.com";
    expect(createAnalyticsClient(() => insecure.runtime).initialize()).toBe(false);
    expect(insecure.appended).toHaveLength(0);
  });

  it("queues Consent Mode v2 before config and disables automatic page views", () => {
    const { appended, runtime, scope } = fakeRuntime({ consent: true });
    const client = createAnalyticsClient(() => runtime);

    expect(client.initialize()).toBe(true);
    expect(client.initialize()).toBe(true);
    expect(appended).toEqual([
      { async: true, id: "zenguy-ga4", src: GA4_SCRIPT_URL },
    ]);
    const queued = commands(scope);
    expect(queued[0]).toEqual([
      "consent",
      "default",
      {
        ad_personalization: "denied",
        ad_storage: "denied",
        ad_user_data: "denied",
        analytics_storage: "denied",
      },
    ]);
    expect(queued[1]).toEqual([
      "consent",
      "update",
      expect.objectContaining({
        ad_personalization: "denied",
        ad_storage: "denied",
        ad_user_data: "denied",
        analytics_storage: "granted",
      }),
    ]);
    expect(queued).toContainEqual([
      "config",
      GA4_MEASUREMENT_ID,
      expect.objectContaining({
        allow_ad_personalization_signals: false,
        allow_google_signals: false,
        app_section: "auth",
        auth_state: "signed_out",
        content_group: "app_auth",
        cookie_domain: "none",
        page_location: "https://app.zenguy.com/signup",
        page_path: "/signup",
        page_referrer: "",
        send_page_view: false,
        surface: "web_app_public",
        user_id: null,
      }),
    ]);
  });

  it("emits only allow-listed, normalized page locations", () => {
    const { runtime, scope } = fakeRuntime({ consent: true });
    const client = createAnalyticsClient(() => runtime);

    expect(client.trackPageView("/w/:wsId/tests/:testId")).toBe(true);
    expect(client.trackPageView("/w/real-workspace/tests/real-test?token=x")).toBe(false);
    expect(commands(scope).at(-1)).toEqual([
      "event",
      "page_view",
      {
        app_section: "tests",
        auth_state: "signed_out",
        content_group: "app_product",
        page_location: "https://app.zenguy.com/w/:wsId/tests/:testId",
        page_path: "/w/:wsId/tests/:testId",
        page_referrer: "",
        page_title: "Zenguy · Browser tests",
        route_pattern: "/w/:wsId/tests/:testId",
        subscription_status: "not_applicable",
        surface: "web_app_public",
        workspace_role: "not_applicable",
      },
    ]);
  });

  it("sets a consented pseudonymous identity and finite workspace context", () => {
    const { runtime, scope } = fakeRuntime({ consent: true });
    runtime.pathname = "/w/ws_1/overview";
    const client = createAnalyticsClient(() => runtime);
    const userId = `za_${"ab".repeat(32)}`;

    expect(
      client.setUserContext({
        accountAgeBucket: "30_89d",
        userId,
        workspaceCountBucket: "2_3",
      }),
    ).toBe(true);
    expect(
      client.trackPageView("/w/:wsId/overview", {
        authState: "signed_in_verified",
        subscriptionStatus: "ACTIVE",
        workspaceRole: "OWNER",
      }),
    ).toBe(true);

    expect(commands(scope)).toContainEqual([
      "set",
      "user_properties",
      {
        account_age_bucket: "30_89d",
        workspace_count_bucket: "2_3",
      },
    ]);
    expect(commands(scope)).toContainEqual([
      "config",
      GA4_MEASUREMENT_ID,
      expect.objectContaining({ user_id: userId }),
    ]);
    expect(commands(scope).at(-1)).toEqual([
      "event",
      "page_view",
      expect.objectContaining({
        auth_state: "signed_in_verified",
        subscription_status: "active",
        surface: "web_app_authenticated",
        workspace_role: "owner",
      }),
    ]);

    expect(client.setUserContext(null)).toBe(true);
    expect(commands(scope).at(-1)).toEqual([
      "config",
      GA4_MEASUREMENT_ID,
      { send_page_view: false, update: true, user_id: null },
    ]);
  });

  it("updates page context for later events without emitting another page view", () => {
    const { runtime, scope } = fakeRuntime({ consent: true });
    runtime.pathname = "/w/ws_1/overview";
    const client = createAnalyticsClient(() => runtime);

    expect(
      client.trackPageView("/w/:wsId/overview", {
        authState: "signed_in_verified",
        subscriptionStatus: "NONE",
        workspaceRole: "MEMBER",
      }),
    ).toBe(true);
    expect(
      client.updatePageContext("/w/:wsId/overview", {
        authState: "signed_in_verified",
        subscriptionStatus: "ACTIVE",
        workspaceRole: "OWNER",
      }),
    ).toBe(true);
    expect(client.track(subscriptionCheckoutEvent(EUR_PRICE))).toBe(true);

    const queued = commands(scope);
    expect(
      queued.filter(
        (command) => command[0] === "event" && command[1] === "page_view",
      ),
    ).toHaveLength(1);
    expect(queued.at(-2)).toEqual([
      "config",
      GA4_MEASUREMENT_ID,
      expect.objectContaining({
        send_page_view: false,
        subscription_status: "active",
        update: true,
        workspace_role: "owner",
      }),
    ]);
    expect(queued.at(-1)).toEqual([
      "event",
      "begin_checkout",
      expect.objectContaining({
        subscription_status: "active",
        workspace_role: "owner",
      }),
    ]);
  });

  it("keeps safe campaign attribution while never sending the query in page_location", () => {
    const { runtime, scope } = fakeRuntime({ consent: true });
    runtime.search =
      "?utm_source=partner&utm_medium=referral&utm_campaign=august_launch&utm_content=hero_cta&zg_cta=hero_signup&next=%2Fw%2Fsecret";
    const client = createAnalyticsClient(() => runtime);

    expect(client.trackPageView("/signup")).toBe(true);
    expect(commands(scope)).toContainEqual([
      "config",
      GA4_MEASUREMENT_ID,
      expect.objectContaining({
        campaign_content: "hero_cta",
        campaign_medium: "referral",
        campaign_name: "august_launch",
        campaign_source: "partner",
        cta_location: "hero_signup",
        page_location: "https://app.zenguy.com/signup",
      }),
    ]);
    expect(JSON.stringify(commands(scope))).not.toContain("next=");
  });

  it("rejects unknown parameters that could smuggle PII", () => {
    expect(
      isAllowedAnalyticsEvent({
        name: "sign_up",
        params: { email: "person@example.com", method: "email" },
      }),
    ).toBe(false);
    expect(isAllowedAnalyticsEvent(subscriptionCheckoutEvent(EUR_PRICE))).toBe(true);
    expect(isAllowedAnalyticsEvent(subscriptionCheckoutEvent(USD_PRICE))).toBe(true);
    expect(
      isAllowedAnalyticsEvent({
        ...subscriptionCheckoutEvent(USD_PRICE),
        params: { ...subscriptionCheckoutEvent(USD_PRICE).params, currency: "GBP" },
      }),
    ).toBe(false);
  });

  it("denies consent and requires a clean reload after a loaded tag is revoked", () => {
    const { runtime, scope } = fakeRuntime({ consent: true });
    const client = createAnalyticsClient(() => runtime);
    expect(client.initialize()).toBe(true);

    writeCookieConsent(
      false,
      runtime.storage,
      new Date("2026-08-30T12:01:00.000Z"),
    );
    expect(client.revoke()).toBe(true);
    expect(commands(scope).at(-1)).toEqual([
      "consent",
      "update",
      {
        ad_personalization: "denied",
        ad_storage: "denied",
        ad_user_data: "denied",
        analytics_storage: "denied",
      },
    ]);
    expect(client.trackPageView("/signup")).toBe(false);
  });
});

describe("safe analytics identity and attribution", () => {
  it("keeps the cross-surface campaign and CTA catalogs immutable at runtime", () => {
    expect(Object.isFrozen(ANALYTICS_CAMPAIGN_CATALOG)).toBe(true);
    expect(Object.values(ANALYTICS_CAMPAIGN_CATALOG).every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(ANALYTICS_CTA_LOCATIONS)).toBe(true);
  });

  it("derives a deterministic purpose-specific id only from production user ids", async () => {
    const digest = vi.fn(async () => new Uint8Array(32).fill(0xab).buffer);
    const subtle = { digest } as unknown as Pick<SubtleCrypto, "digest">;
    const internalId = "usr_01j00000000000000000000000";

    const result = await analyticsUserIdFor(internalId, subtle);
    expect(result).toBe(`za_${"ab".repeat(32)}`);
    expect(result).not.toContain(internalId);
    expect(await analyticsUserIdFor("person@example.com", subtle)).toBeNull();
    expect(digest).toHaveBeenCalledOnce();
  });

  it("accepts only complete catalogued campaigns", () => {
    expect(
      safeCampaignContext(
        "?utm_source=Product-Hunt&utm_medium=Paid.Social&utm_campaign=Q3-Launch&utm_content=hero.cta",
      ),
    ).toEqual({
      campaign_content: "hero_cta",
      campaign_medium: "paid_social",
      campaign_name: "q3_launch",
      campaign_source: "product_hunt",
    });
    expect(
      safeCampaignContext(
        "?utm_source=benign_new_partner&utm_medium=new_channel&utm_campaign=autumn_2026&utm_content=new_creative",
      ),
    ).toEqual({
      campaign_medium: "other",
      campaign_name: "other",
      campaign_source: "other",
    });
    expect(
      safeCampaignContext("?utm_source=newsletter&utm_medium=email"),
    ).toBeNull();
    expect(
      safeCampaignContext(
        "?utm_source=person%40example.com&utm_medium=email&utm_campaign=launch",
      ),
    ).toBeNull();
    expect(
      safeCampaignContext(
        "?utm_source=newsletter&utm_medium=email&utm_campaign=550e8400-e29b-41d4-a716-446655440000",
      ),
    ).toBeNull();
    expect(
      safeCampaignContext(
        "?utm_source=newsletter&utm_medium=email&utm_campaign=launch&utm_content=access-token",
      ),
    ).toBeNull();
    expect(
      safeCampaignContext(
        "?utm_source=newsletter&utm_medium=email&utm_campaign=launch&utm_term=secret",
      ),
    ).toBeNull();
    expect(
      safeCampaignContext(
        "?utm_source=one&utm_source=two&utm_medium=email&utm_campaign=launch",
      ),
    ).toBeNull();
  });

  it("accepts only a finite first-party CTA location", () => {
    expect(safeEntryCtaContext("?zg_cta=nav_signup&email=alice@example.com")).toEqual({
      cta_location: "nav_signup",
    });
    expect(safeEntryCtaContext("?zg_cta=alice@example.com")).toBeNull();
    expect(safeEntryCtaContext("?zg_cta=nav_signup&zg_cta=hero_signup")).toBeNull();
    expect(safeEntryCtaContext("?utm_source=partner")).toBeNull();
  });

  it("emits sign_up once only after a genuinely verified session", async () => {
    const analytics = {
      setUserContext: vi.fn(() => true),
      track: vi.fn(() => true),
      updatePageContext: vi.fn(() => true),
    };
    const deriveUserId = vi.fn(async () => `za_${"ab".repeat(32)}`);
    const trackVerifiedSignUp = createVerifiedSignUpTracker(
      analytics,
      deriveUserId,
    );
    const user = {
      createdAt: "2026-08-30T10:00:00.000Z",
      emailVerified: true,
      id: "usr_01j00000000000000000000000",
    };

    await expect(trackVerifiedSignUp({ ...user, emailVerified: false })).resolves.toBe(false);
    await expect(trackVerifiedSignUp(user)).resolves.toBe(true);
    await expect(trackVerifiedSignUp(user)).resolves.toBe(false);

    expect(analytics.setUserContext).toHaveBeenCalledOnce();
    expect(analytics.updatePageContext).toHaveBeenCalledWith("/verify-email", {
      authState: "signed_in_verified",
    });
    expect(analytics.track).toHaveBeenCalledOnce();
    expect(analytics.track).toHaveBeenCalledWith({
      name: "sign_up",
      params: { method: "email" },
    });
  });

  it("uses finite account-age and workspace-count buckets", () => {
    const now = Date.parse("2026-08-30T12:00:00.000Z");
    expect(accountAgeBucketFor("2026-08-29T12:00:00.000Z", now)).toBe("lt_7d");
    expect(accountAgeBucketFor("2026-07-31T11:59:59.000Z", now)).toBe("30_89d");
    expect(accountAgeBucketFor("not-a-date", now)).toBeNull();
    expect(workspaceCountBucketFor(0)).toBe("0");
    expect(workspaceCountBucketFor(3)).toBe("2_3");
    expect(workspaceCountBucketFor(7)).toBe("4_plus");
  });
});

describe("confirmed purchase event", () => {
  const now = Date.parse("2026-08-30T12:00:00.000Z");
  const checkoutStartedAt = Date.parse("2026-08-30T11:50:00.000Z");

  it("uses a one-time checkout marker from this browser tab", () => {
    const storage = checkoutStorage();
    expect(rememberSubscriptionCheckout("ws_123", storage, checkoutStartedAt)).toBe(true);
    expect(
      readRememberedSubscriptionCheckout("ws_123", storage, now),
    ).toBe(checkoutStartedAt);
    expect(
      readRememberedSubscriptionCheckout("ws_123", storage, now),
    ).toBe(checkoutStartedAt);
    forgetRememberedSubscriptionCheckout("ws_123", storage);
    expect(readRememberedSubscriptionCheckout("ws_123", storage, now)).toBeNull();
  });

  it("uses a recent paid provider invoice as the unique transaction", () => {
    expect(
      confirmedSubscriptionPurchaseEvent(
        activeBilling(),
        checkoutStartedAt,
        now,
      ),
    ).toEqual({
      name: "purchase",
      params: {
        billing_purpose: "subscription",
        currency: "EUR",
        items: [
          {
            item_id: "workspace_monthly",
            item_name: "Zenguy workspace monthly",
            price: 39,
            quantity: 1,
          },
        ],
        transaction_id: "in_123",
        value: 39,
      },
    });
  });

  it("uses the persisted USD plan and invoice currency", () => {
    const eur = activeBilling();
    const usd = activeBilling({
      invoices: eur.invoices.map((invoice) => ({ ...invoice, currency: "USD" })),
      plan: { ...eur.plan, currency: "USD" },
      usage: { ...eur.usage, currency: "USD" },
    });

    expect(
      confirmedSubscriptionPurchaseEvent(usd, checkoutStartedAt, now),
    ).toMatchObject({
      params: {
        currency: "USD",
        items: [{ price: 39 }],
        value: 39,
      },
    });
  });

  it("does not infer purchases from active state without current payment proof", () => {
    expect(
      confirmedSubscriptionPurchaseEvent(
        activeBilling({ invoices: [] }),
        checkoutStartedAt,
        now,
      ),
    ).toBeNull();
    expect(
      confirmedSubscriptionPurchaseEvent(
        activeBilling({
          invoices: [
            {
              billedAt: "2026-08-01T00:00:00.000Z",
              currency: "EUR",
              id: "in_old",
              invoiceNumber: null,
              status: "paid",
              totalCents: 3_900,
            },
          ],
        }),
        checkoutStartedAt,
        now,
      ),
    ).toBeNull();
    expect(
      confirmedSubscriptionPurchaseEvent(
        activeBilling({
          subscription: {
            ...activeBilling().subscription,
            source: "free",
          },
        }),
        checkoutStartedAt,
        now,
      ),
    ).toBeNull();
  });

  it("rejects invoices that are not correlated with the initiated checkout", () => {
    expect(
      confirmedSubscriptionPurchaseEvent(
        activeBilling({
          invoices: [
            {
              billedAt: "2026-08-30T11:00:00.000Z",
              currency: "EUR",
              id: "in_renewal",
              invoiceNumber: null,
              status: "paid",
              totalCents: 3_900,
            },
          ],
        }),
        checkoutStartedAt,
        now,
      ),
    ).toBeNull();
    expect(
      confirmedSubscriptionPurchaseEvent(
        activeBilling({
          subscription: {
            ...activeBilling().subscription,
            periodStart: "2026-08-01T00:00:00.000Z",
          },
        }),
        checkoutStartedAt,
        now,
      ),
    ).toBeNull();
  });
});
