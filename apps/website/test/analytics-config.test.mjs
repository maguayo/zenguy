import assert from "node:assert/strict";
import test from "node:test";

import {
  ANALYTICS_CAMPAIGN_CATALOG,
  ANALYTICS_CAMPAIGN_CONTENT,
  ANALYTICS_CAMPAIGN_MEDIA,
  ANALYTICS_CAMPAIGN_NAMES,
  ANALYTICS_CAMPAIGN_SOURCES,
  ANALYTICS_SURFACE,
  CONSENT_KEY,
  CONSENT_MAX_AGE_MS,
  GA_COOKIE_DOMAIN,
  buildTrackedAppHref,
  cleanPageLocation,
  isAnalyticsProductionLocation,
  isConsentRecord,
  isSafeCampaign,
  parseSafeCampaign,
  publicPageAnalyticsContext,
  resolveSafeCampaign,
} from "../src/scripts/analytics-config.mjs";

test("uses the coordinated versioned consent key and exact schema", () => {
  const now = Date.parse("2026-08-30T12:00:00.000Z");
  const record = { version: 2, analytics: true, updatedAt: new Date(now).toISOString() };

  assert.equal(CONSENT_KEY, "zenguy:cookie-consent:v1");
  assert.equal(isConsentRecord(record, now), true);
  assert.equal(isConsentRecord({ ...record, extra: true }, now), false);
  assert.equal(isConsentRecord({ ...record, version: 1 }, now), false);
  assert.equal(
    isConsentRecord({ ...record, updatedAt: new Date(now - CONSENT_MAX_AGE_MS - 1).toISOString() }, now),
    false,
  );
});

test("keeps the GA cookie host-only so consent remains independent by origin", () => {
  assert.equal(GA_COOKIE_DOMAIN, "none");
});

test("permits analytics only on the two HTTPS production hosts", () => {
  const location = (hostname, protocol = "https:", port = "") => ({ hostname, protocol, port });

  assert.equal(isAnalyticsProductionLocation(location("zenguy.com")), true);
  assert.equal(isAnalyticsProductionLocation(location("www.zenguy.com")), true);
  assert.equal(isAnalyticsProductionLocation(location("app.zenguy.com")), false);
  assert.equal(isAnalyticsProductionLocation(location("preview.pages.dev")), false);
  assert.equal(isAnalyticsProductionLocation(location("localhost", "http:", "4400")), false);
  assert.equal(isAnalyticsProductionLocation(location("zenguy.com", "http:")), false);
  assert.equal(isAnalyticsProductionLocation(location("zenguy.com", "https:", "8443")), false);
});

test("normalizes page_location without query strings or fragments", () => {
  const source = new URL("https://zenguy.com/pricing/?utm_source=test#plans");
  assert.equal(cleanPageLocation(source), "https://zenguy.com/pricing/");
});

test("accepts a build-time route so an arbitrary 404 request cannot leak its path", () => {
  assert.equal(
    cleanPageLocation({ origin: "https://zenguy.com", pathname: "/404" }),
    "https://zenguy.com/404",
  );
});

test("classifies public pages into a finite reporting taxonomy", () => {
  const expected = (content_group) => ({
    surface: "public_web",
    content_group,
  });

  assert.equal(ANALYTICS_SURFACE, "public_web");
  assert.deepEqual(publicPageAnalyticsContext("/"), expected("public_home"));
  assert.deepEqual(publicPageAnalyticsContext("/proposal1/"), expected("public_landing"));
  assert.deepEqual(publicPageAnalyticsContext("/articles/"), expected("public_content_hub"));
  assert.deepEqual(
    publicPageAnalyticsContext("/articles/monitor-login-and-onboarding/"),
    expected("public_article"),
  );
  for (const path of ["/cookies/", "/legal-notice/", "/privacy/", "/terms/"]) {
    assert.deepEqual(publicPageAnalyticsContext(path), expected("public_legal"));
  }
  assert.deepEqual(publicPageAnalyticsContext("/404"), expected("error"));
  assert.deepEqual(publicPageAnalyticsContext("/an-arbitrary-request/"), expected("error"));
});

test("accepts only complete, normalized low-cardinality campaigns", () => {
  const campaign = parseSafeCampaign(
    new URLSearchParams(
      "utm_source=LinkedIn&utm_medium=Paid+Social&utm_campaign=Q3+Launch&utm_content=Hero+CTA&ref=homepage",
    ),
  );

  assert.deepEqual(campaign, {
    campaign_source: "linkedin",
    campaign_medium: "paid_social",
    campaign_name: "q3_launch",
    campaign_content: "hero_cta",
  });
  assert.deepEqual(
    parseSafeCampaign(
      new URLSearchParams("utm_source=newsletter&utm_medium=email&utm_campaign=launch"),
    ),
    {
      campaign_source: "newsletter",
      campaign_medium: "email",
      campaign_name: "launch",
    },
  );
});

test("exports the exact finite campaign catalogs used by every parser result", () => {
  assert.deepEqual(ANALYTICS_CAMPAIGN_CATALOG, {
    source: ANALYTICS_CAMPAIGN_SOURCES,
    medium: ANALYTICS_CAMPAIGN_MEDIA,
    name: ANALYTICS_CAMPAIGN_NAMES,
    content: ANALYTICS_CAMPAIGN_CONTENT,
  });
  assert.equal(Object.isFrozen(ANALYTICS_CAMPAIGN_CATALOG), true);
  for (const catalog of Object.values(ANALYTICS_CAMPAIGN_CATALOG)) {
    assert.equal(Object.isFrozen(catalog), true);
    assert.equal(catalog.includes("other"), true);
  }
});

test("collapses benign unknown campaign dimensions and drops unknown creative content", () => {
  assert.deepEqual(
    parseSafeCampaign(
      new URLSearchParams(
        "utm_source=community&utm_medium=sponsorship&utm_campaign=autumn-wave&utm_content=blue-button",
      ),
    ),
    {
      campaign_source: "other",
      campaign_medium: "other",
      campaign_name: "other",
    },
  );
});

test("validates persisted campaigns against exact keys and finite catalogs", () => {
  const campaign = {
    campaign_source: "linkedin",
    campaign_medium: "paid_social",
    campaign_name: "q3_launch",
    campaign_content: "hero_cta",
  };
  assert.equal(isSafeCampaign(campaign), true);
  assert.equal(isSafeCampaign({ ...campaign, campaign_source: "free_text" }), false);
  assert.equal(isSafeCampaign({ ...campaign, user_email: "person@example.com" }), false);
  assert.equal(isSafeCampaign({ campaign_source: "linkedin" }), false);
});

test("never inherits stored attribution when the current URL contains invalid UTM keys", () => {
  const stored = {
    campaign_source: "linkedin",
    campaign_medium: "paid_social",
    campaign_name: "q3_launch",
    campaign_content: "hero_cta",
  };

  assert.deepEqual(
    resolveSafeCampaign(
      new URLSearchParams("utm_source=newsletter&utm_medium=email"),
      stored,
    ),
    { campaign: null, source: "invalid_url" },
  );
  assert.deepEqual(
    resolveSafeCampaign(new URLSearchParams("utm_term=unsafe"), stored),
    { campaign: null, source: "invalid_url" },
  );
  assert.deepEqual(
    resolveSafeCampaign(new URLSearchParams("ref=internal-navigation"), stored),
    { campaign: stored, source: "session" },
  );
});

test("rejects incomplete, ambiguous, disallowed and identifier-like campaigns", () => {
  const rejected = [
    "utm_source=newsletter&utm_medium=email",
    "utm_source=a&utm_source=b&utm_medium=email&utm_campaign=launch",
    "utm_source=newsletter&utm_medium=email&utm_campaign=launch&utm_term=monitoring",
    "utm_source=person%40example.com&utm_medium=email&utm_campaign=launch",
    "utm_source=newsletter&utm_medium=email&utm_campaign=550e8400-e29b-41d4-a716-446655440000",
    "utm_source=newsletter&utm_medium=email&utm_campaign=eyjhbGciOiJIUzI1NiJ9eyJzdWIiOiIxMjM0NTY3ODkwIn0",
    `utm_source=newsletter&utm_medium=email&utm_campaign=${"a".repeat(65)}`,
    "utm_source=newsletter&utm_medium=email&utm_campaign=launch&utm_content=access_token",
  ];

  for (const query of rejected) {
    assert.equal(parseSafeCampaign(new URLSearchParams(query)), null, query);
  }
});

test("decorates approved app links while preserving creative content separately from CTA", () => {
  const campaign = parseSafeCampaign(
    new URLSearchParams(
      "utm_source=Partner&utm_medium=Referral&utm_campaign=August+Launch&utm_content=entry",
    ),
  );
  assert.ok(campaign);
  const tracked = buildTrackedAppHref(
    "https://app.zenguy.com/signup?untrusted=value#fragment",
    campaign,
    "hero_signup",
    "signup",
  );
  assert.ok(tracked);

  const url = new URL(tracked);
  assert.equal(url.origin, "https://app.zenguy.com");
  assert.equal(url.pathname, "/signup");
  assert.equal(url.hash, "");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    utm_source: "partner",
    utm_medium: "referral",
    utm_campaign: "august_launch",
    utm_content: "entry",
    zg_cta: "hero_signup",
  });
});

test("uses a fixed owned fallback and refuses unapproved CTA destinations", () => {
  const fallback = buildTrackedAppHref(
    "https://app.zenguy.com/signin",
    null,
    "nav_signin",
    "signin",
  );
  assert.ok(fallback);
  assert.deepEqual(Object.fromEntries(new URL(fallback).searchParams), {
    utm_source: "zenguy_public",
    utm_medium: "owned",
    utm_campaign: "site_to_app",
    zg_cta: "nav_signin",
  });

  assert.equal(
    buildTrackedAppHref(
      "https://evil.example/signup",
      null,
      "hero_signup",
      "signup",
    ),
    null,
  );
  assert.equal(
    buildTrackedAppHref(
      "https://app.zenguy.com/signin",
      null,
      "free_text",
      "signin",
    ),
    null,
  );
  assert.equal(
    buildTrackedAppHref(
      "https://app.zenguy.com/signin",
      null,
      "nav_signin",
      "signup",
    ),
    null,
  );
});
