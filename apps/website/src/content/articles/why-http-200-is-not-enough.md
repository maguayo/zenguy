---
title: "Why an HTTP 200 is not enough"
description: "A 200 means the server answered. It does not mean the cart still totals, the button still works, or a customer can pay."
pubDate: 2026-08-22
category: guide
tags:
  - uptime
  - http
  - production
related:
  - ci-passed-production-broke
  - uptime-monitoring-and-browser-tests
  - how-to-monitor-a-checkout-flow
  - uptimerobot-alternative
image: /articles/why-http-200-is-not-enough.jpg
imageAlt: "A cream status brick with a green LED in front of a laptop glowing violet."
---

Uptime monitoring is a health check from the outside: request a URL, accept a status code, maybe hunt for a string, record latency.

That is necessary. It is also how a store can be “100% up” while charging 0,00 €.

## What a 200 actually certifies

A 200 says: *this origin, from this probe, returned a success status within the timeout.*

It does not say:

- the HTML contains a working checkout;
- JavaScript finished;
- the price API returned a number;
- the cookie banner did not block the button;
- the mobile layout still shows pay;
- the third-party iframe loaded;
- the total on the next page matches the last one.

A 500 is a clear outage. A 200 with a broken total is a **silent** outage. Customers produce it. Status pages do not.

![Checkout order summary captured by a Zenguy run, showing a total of 0,00 €.](/hero/step-checkout.png)

## The classic night

14:02 — CI is green. The health endpoint is green. Everyone goes home.

03:14 — a price feed goes quiet. The product page still renders. Add to cart still 200s. Checkout renders **0,00 €**. Every ping is still green.

09:40 — a customer asks if the sale is free.

Thirteen hours. That timeline is the reason Zenguy exists. Pings did their job. The job was the wrong size.

## Keyword checks are a partial patch

“Alert me if the homepage does not contain `Add to cart`” catches some deploys. It fails when:

- the string is in a hidden template;
- the button is there and the handler is dead;
- the failure is a number (`0,00` vs `149,00`) you did not think to keyword;
- the failure is on the *next* page.

Keywords are still worth having. They are not a user.

## What to run instead of “just pings”

Keep the pings. Add a **browser-level goal**:

> Open a product. Remember the price. Add it. Check the cart. Open checkout. Check the total again. Do not pay.

You want:

- a real browser, not curl;
- a clean session each attempt;
- a screenshot of the failed total;
- retries, so a slow third party does not become an incident;
- an alert that quotes the expected and the observed, not “check failed”.

That is synthetic monitoring. Zenguy's version is the goal written in English. Playwright's version is the goal written as a spec. Either beats a 200.

## When a 200 *is* enough

- A static marketing page with no funnel.
- An API you only need to know is reachable (still prefer a body assertion).
- A dependency you do not walk as a user (queue, webhook inbox) — use an HTTP monitor with an expected body, not a browser.

Match the probe to the failure. Origins die with non-200s. Checkouts die with 200s.

## Zenguy's split

HTTP monitors in Zenguy still exist, unlimited, from every 5 minutes. Use them for `/health`, sitemaps, webhooks.

Browser tests exist so the 200 is not the last word. When they fail, the report says what the page showed. That is the missing half of “uptime”.
