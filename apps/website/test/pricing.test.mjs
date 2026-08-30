import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import {
  onRequestGet,
  pricingCurrencyForCf,
} from "../functions/api/pricing.js";
import {
  PRICING_BY_CURRENCY,
  isPricingPayload,
} from "../src/lib/pricing.mjs";
import {
  applyPricing,
  loadPricing,
} from "../src/scripts/pricing.mjs";

test("prefers the EU flag, falls back to country, then to local EUR", () => {
  assert.equal(pricingCurrencyForCf({ country: "ES", isEUCountry: "1" }), "EUR");
  assert.equal(pricingCurrencyForCf({ country: "US", isEUCountry: "1" }), "EUR");
  assert.equal(pricingCurrencyForCf({ country: "ES" }), "EUR");
  assert.equal(pricingCurrencyForCf({ country: "US" }), "USD");
  assert.equal(pricingCurrencyForCf({ country: "ES", isEUCountry: false }), "USD");
  assert.equal(pricingCurrencyForCf({ isEUCountry: "0" }), "USD");
  assert.equal(pricingCurrencyForCf(undefined), "EUR");
  assert.equal(pricingCurrencyForCf({}), "EUR");
});

test("serves the selected amount without allowing a shared edge cache", async () => {
  const request = { cf: { country: "US" } };
  const response = onRequestGet({ request });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("content-type"), /^application\/json/u);
  assert.deepEqual(await response.json(), PRICING_BY_CURRENCY.USD);
});

test("accepts only the exact finite pricing contract", () => {
  assert.equal(isPricingPayload(PRICING_BY_CURRENCY.EUR), true);
  assert.equal(isPricingPayload(PRICING_BY_CURRENCY.USD), true);
  assert.equal(
    isPricingPayload({ ...PRICING_BY_CURRENCY.USD, monthlyCents: 4_900 }),
    false,
  );
  assert.equal(
    isPricingPayload({ ...PRICING_BY_CURRENCY.EUR, visitorCountry: "ES" }),
    false,
  );
});

function pricingRoot() {
  const monthly = [{ textContent: "39 €" }, { textContent: "39 €" }];
  const overage = [{ textContent: "0,20 €" }];
  return {
    documentElement: { dataset: {} },
    monthly,
    overage,
    querySelectorAll(selector) {
      return selector.includes("monthly") ? monthly : overage;
    },
  };
}

test("updates every marked amount and records the active currency", () => {
  const root = pricingRoot();

  assert.equal(applyPricing(root, PRICING_BY_CURRENCY.USD), true);
  assert.deepEqual(root.monthly.map(({ textContent }) => textContent), ["$39", "$39"]);
  assert.deepEqual(root.overage.map(({ textContent }) => textContent), ["$0.20"]);
  assert.equal(root.documentElement.dataset.pricingCurrency, "USD");
});

test("keeps the EUR fallback when the endpoint fails or returns invalid data", async () => {
  const failedRoot = pricingRoot();
  assert.equal(
    await loadPricing({
      root: failedRoot,
      fetchImpl: async () => new Response(null, { status: 503 }),
    }),
    false,
  );
  assert.equal(failedRoot.monthly[0].textContent, "39 €");

  const invalidRoot = pricingRoot();
  assert.equal(
    await loadPricing({
      root: invalidRoot,
      fetchImpl: async () => Response.json({ currency: "USD" }),
    }),
    false,
  );
  assert.equal(invalidRoot.monthly[0].textContent, "39 €");
});

test("all public pricing surfaces use the shared price marker", async () => {
  const surfaces = [
    "src/components/Hero.astro",
    "src/components/Pricing.astro",
    "src/components/ArticleCta.astro",
    "src/components/proposal1/Pricing.astro",
    "src/components/proposal2/Pricing2.astro",
    "src/components/proposal2/Cta2.astro",
  ];
  for (const path of surfaces) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    assert.match(source, /<Price kind="monthly"/u, path);
    assert.doesNotMatch(source, /39 €|0,20 €/u, path);
  }
});

test("article subscription prices cannot bypass the shared price markers", async () => {
  const articlesDirectory = new URL("../src/content/articles/", import.meta.url);
  const articleFiles = (await readdir(articlesDirectory)).filter((name) =>
    name.endsWith(".md"),
  );
  const monthlyMarker = `<span data-pricing-amount="monthly">${PRICING_BY_CURRENCY.EUR.monthlyDisplay}</span>`;
  const overageMarker = `<span data-pricing-amount="overage">${PRICING_BY_CURRENCY.EUR.overageDisplay}</span>`;
  let markerCount = 0;

  for (const file of articleFiles) {
    const source = await readFile(new URL(file, articlesDirectory), "utf8");
    markerCount += source.split(monthlyMarker).length - 1;
    markerCount += source.split(overageMarker).length - 1;
    const withoutLocalizedFallbacks = source
      .replaceAll(monthlyMarker, "")
      .replaceAll(overageMarker, "");

    assert.doesNotMatch(
      withoutLocalizedFallbacks,
      /(?:39\s*€|€\s*39|0[,.]20\s*€)/u,
      `${file} contains an unmarked subscription price`,
    );
  }

  assert.ok(markerCount > 0, "expected localized prices in the article corpus");
});
