---
title: "What is synthetic monitoring?"
description: "Synthetic monitoring is a scripted user you run on purpose, against production, so a real user is not the first to find the break."
pubDate: 2026-08-20
category: guide
tags:
  - synthetic monitoring
  - guide
related:
  - best-synthetic-monitoring-tools
  - why-http-200-is-not-enough
  - playwright-vs-production-monitoring
  - browser-tests-in-plain-english
image: /articles/what-is-synthetic-monitoring.jpg
imageAlt: "An empty office at night with one browser still walking a website, no one at the keyboard."
---

Synthetic monitoring is a robot that uses your product on a schedule so you do not have to wait for a customer to do it badly, in public, at 09:40.

The robot is “synthetic” because it is not a real user (that is RUM). It is “monitoring” because it runs continuously against the live system (that is not CI).

## The family of probes

From cheapest / shallowest to richest / slowest:

1. **ICMP / TCP** — is the host there.
2. **HTTP uptime** — does this URL return the status you expect, fast enough, maybe containing a string.
3. **API multi-step** — a chain of requests with assertions on JSON.
4. **Browser synthetic** — a real browser clicks and reads the page.

Zenguy sells (2) and (4). The browser step is written in English instead of Playwright.

## Why browsers exist in this list

A lot of the product *is* the page. Totals, buttons, client-side routing, consent walls, hosted payment fields — they only exist after JavaScript. Curl will not tell you the checkout summary is 0,00 €.

Browser synthetics are expensive in time and money compared with pings, so you do not put them on every URL. You put them on **login, search, signup, checkout**.

## Synthetic vs CI vs RUM vs APM

| | Proves | Weak at |
|---|---|---|
| CI (Playwright, Cypress) | This commit, this env | Live DNS, third parties, “right now” |
| HTTP uptime | The origin answers | Logic, UI, multi-step |
| Synthetic browser | A path still completes on prod | Coverage of all users, all browsers |
| RUM | What real users hit | The 3 a.m. failure with zero traffic |
| APM | Internal timings and errors | Anything outside the process |

You want several of these. You cannot collapse them into one purchase without lying to yourself.

## How Zenguy implements the browser kind

- Instructions in natural language, not selectors.
- Isolated Chromium, desktop 1440×900 or mobile 390×844.
- Clean profile every attempt — no leftover cookies.
- 5-minute timeout, up to three courtesy retries.
- Schedule every 1–24 hours.
- Evidence: screenshots, steps, expected vs actual, console/network, Markdown on failure.
- Secrets write-only, pinned to an allow-list of domains.

The agent is told to treat page content as data, not as new instructions, and to stop before irreversible actions unless you said otherwise.

## How often to run

Sub-minute synthetics are for APIs and for enterprises with a location matrix. For a checkout walk, **hourly** is the value: you shrink a thirteen-hour silent failure to something like seven minutes plus retries.

If you need 30-second detection that the host is dead, that is an HTTP monitor, not a browser.

## Getting started

Pick one flow you would hate a customer to find broken. Write it as a goal. Run it once. If the screenshots look like the product, schedule it. Add a ping for the origin. Stop there until that pair is boring.

More detail: [browser tests in plain English](/articles/browser-tests-in-plain-english/), [how to monitor a checkout flow](/articles/how-to-monitor-a-checkout-flow/).
