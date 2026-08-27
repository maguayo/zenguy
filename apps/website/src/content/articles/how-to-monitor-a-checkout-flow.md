---
title: "How to monitor a checkout flow"
description: "Write the walk in English, use a staging cart, assert totals twice, and stop before you pay. A practical setup for production checkout."
pubDate: 2026-08-19
category: guide
tags:
  - checkout
  - guide
  - ecommerce
related:
  - best-tools-to-monitor-checkout
  - how-to-monitor-a-shopify-store
  - how-to-get-alerted-when-checkout-breaks
  - why-http-200-is-not-enough
image: /articles/how-to-monitor-a-checkout-flow.jpg
imageAlt: "A clothing-store checkout: red basket, card terminal, and a receipt printer on the belt."
---

A checkout monitor is not “hit `/checkout` every five minutes”. It is a **walk with memory**: pick a product, remember the price, add it, check the cart, continue, check again, stop.

Here is a setup that works on Zenguy. The same structure applies if you later encode it in Playwright.

![The failure this watch is for: checkout still renders, the total is 0,00 €.](/hero/step-checkout.png)

## 1. Use a catalog you are allowed to abuse

- A staging store, or a production product with a **test** coupon and a test gateway.
- Never a real customer account. Never a real card.
- If the agent must log in, store the password as a workspace secret and allow-list only the shop and the payment domains.

Zenguy will not place an order unless the instructions are unambiguous. Still write the stop:

> Do not place the order. Do not submit payment.

## 2. Write checks, not clicks

Clicks without checks are a tour. The failure you care about is a **number**.

A complete instruction:

> Go to example.com. Confirm the home page shows more than four products. Open one. Note the current price and any struck-through price. Add it to the cart. Check the cart contains that product and the total matches. Continue to checkout. Check the totals again. Do not place the order.

Notice: “matches”, “more than four”, “contains”. The agent is required to observe, not to assume.

## 3. Decide desktop vs mobile

If a meaningful share of orders is on phones, duplicate the test on the **mobile viewport** (390×844). Plenty of checkouts die on a button that exists only at 1440px.

Do not invent extra breakpoints. Two is enough.

## 4. Pick an interval that matches the cost of silence

Hourly is the default. A checkout that breaks at 03:14 is found at 04:14, not at 09:40.

Every minute is almost never worth a full browser. Use an HTTP monitor on the checkout host for that, and keep the walk hourly.

Zenguy allows 1–24 hours. 300 runs a month is roughly ten tests at a one-hour interval, or fewer tests more often. Count before you clone.

## 5. Turn on retries, then one alert

Set retries to 3. The first retry is immediate; later ones wait a minute, then two. An incident opens only if all of them fail. Recovery sends a second message.

Route it to Slack (or Discord) for the team, and iOS push or SMS for the person who would actually get out of bed.

## 6. Read the first failure on purpose

Run `Test it` in the afternoon. Then break something on staging — hide the button, zero the total — and confirm:

- the screenshot shows the wrong total;
- expected vs actual is a sentence a human can use;
- the Markdown report downloads;
- secrets are blanked.

If the first intentional failure is messy, the 3 a.m. one will be too.

## 7. What not to monitor

- Every A/B variant.
- Guest *and* logged-in *and* express checkout on day one. Pick one happy path.
- Completing a real purchase “to be sure”. Use a sandbox, or stop at the review step.

## Example coverage for a shop

| Test | Device | Interval | Why |
|---|---|---|---|
| Guest checkout to review step | Desktop | 1 h | Revenue |
| Same path | Mobile | 2 h | Layout |
| Login + account order list | Desktop | 6 h | Auth |
| HTTP `/` and checkout host | — | 5 min | Origin death |

That set is already a serious watch. Expand only after it is boring.

When it fails, you want the alert to read like a customer ticket, not like a stack trace. That is the whole trick.
