---
title: "Browser tests in plain English"
description: "A Zenguy test is a URL, a paragraph, and a schedule. No selectors, no framework, no agent on your servers."
pubDate: 2026-08-26
category: guide
tags:
  - browser tests
  - natural language
related:
  - natural-language-browser-testing
  - playwright-vs-production-monitoring
  - how-to-monitor-a-checkout-flow
  - checkly-alternative
image: /articles/browser-tests-in-plain-english.jpg
imageAlt: "A person writing a test in handwriting on cream paper in front of a dark computer screen."
---

The product promise is small enough to put on one card:

> Describe a flow once. Zenguy walks it on a schedule and, when it stops working, sends you the screenshots, the steps and the reason before a customer finds it.

This article is that card with the knobs filled in.

## What you type

A browser test has:

- a **name**;
- a **starting URL**;
- **instructions** in ordinary language;
- **desktop** (1440×900) or **mobile** (390×844);
- an interval from **1 to 24 hours**;
- 0 to 3 retries;
- optional notification channels.

There is no step editor. The instructions *are* the test. Example from the homepage:

> Go to example.com. Check that the home page shows more than four products. Open one and make sure the product detail page works. Remember the crossed-out and current prices, add the product to the cart, and check that the prices and totals are correct. Continue to checkout and check them again. Don't place the order.

## What runs

On each attempt Zenguy starts a **clean** Chromium: no cookies, no storage, no leftover login. A `browser-use` agent opens the URL and tries to complete the goal. It has five minutes. If it fails or times out, retries use a new browser, not the wreckage of the last one.

The agent can follow redirects onto other domains (Shopify, Stripe, OAuth). Secrets are only typed on domains you allow-list. Page text cannot talk it into a new mission.

## What you get back

Every attempt tries to keep:

- screenshots at the meaningful steps and at the failure;
- a list of actions with timestamps;
- expected vs actual;
- visited URLs;
- a short console and network summary;
- a Markdown report when the run ends in failed or timeout.

That report is factual. It does not invent a root cause. It is meant to be handed to a person or pasted into a coding agent.

![The storefront as the agent saw it, captured mid-walk.](/hero/step-home.png)

## What a run costs

A **run** is one requested execution: scheduled, `Run now`, or `Test it`. It costs one unit whether it passed, failed, or timed out. Internal retries are free. HTTP uptime is free. The plan is 39 € a month per workspace, 300 runs included, 0,20 € after that. Members are unlimited.

## What it is not

- Not Playwright, Cypress, or Selenium.
- Not CI. Keep those.
- Not a 30-second ping. That is the uptime product sitting next to it.
- Not a license to complete real purchases. Use staging data. Say where to stop.

## Write instructions like a QA lead, not like a poet

Good:

> After login, the dashboard heading should be “Overview” and there should be no banner that says “Payment failed”.

Bad:

> Make sure it feels fine and everything works.

Name the things that, if wrong, mean you would wake someone.

Then press **Test it**. If the screenshots look like your product, save, and let it walk while you sleep.
