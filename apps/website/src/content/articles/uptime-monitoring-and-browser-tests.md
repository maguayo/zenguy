---
title: "Uptime monitoring and browser tests in one workspace"
description: "Pings catch dead origins. Browser tests catch dead checkouts. Zenguy sells both, on purpose, without turning uptime into a second bill."
pubDate: 2026-08-15
category: guide
tags:
  - uptime
  - browser tests
related:
  - why-http-200-is-not-enough
  - best-uptime-monitoring-tools
  - browser-tests-in-plain-english
  - best-website-monitoring-for-small-teams
image: /articles/uptime-monitoring-and-browser-tests.jpg
imageAlt: "A wide monitor split: an uptime chart on the left, a live checkout walk on the right."
---

Two probes, two failures:

- The origin is unreachable. You want to know in minutes.
- The origin is fine and the cart total is 0,00 €. You want a screenshot.

Vendors often sell the first and name the SKU as if it included the second. Zenguy keeps them separate in the product, and together in the bill.

## Uptime monitors

An HTTP monitor in Zenguy is a scheduled request:

- URL, method, optional encrypted headers and body;
- expected status (default 200);
- optional body condition (`contains`, `equals`, JSON path);
- frequency: 5, 10, 15, 30 minutes, then 1, 3, 6, 12, 24 hours;
- timeout up to 30 seconds;
- retries;
- channels and recovery.

Checks **do not** consume browser-test runs. You can cover `/health`, the storefront, a webhook inbox, and a status file without thinking about the 300-run allowance.

They are deliberately simple. No status pages, no 30-second interval, no traceroute product. If you need those, keep UptimeRobot or Better Stack alongside.

## Browser tests

A browser test is a user. It costs a run. It is slow, rich, and scheduled in hours. See [browser tests in plain English](/articles/browser-tests-in-plain-english/).

## How to divide the work

| Question | Probe |
|---|---|
| Is the host dead? | Uptime, 5 minutes |
| Is the JSON health payload still `ok`? | Uptime + body condition |
| Can someone still log in? | Browser test, 1–6 hours |
| Does checkout still total? | Browser test, 1 hour |
| Did we just ship a theme? | `Run now` on the browser test |

Do not turn the browser test into a ping. Do not turn the ping into a checkout.

## Incidents stay separate, alerts can share a channel

A downed origin and a failed checkout are different incidents. They can still land in `#storefront-alerts`. The Slack message for a browser failure quotes the observed total. The uptime message quotes the status code. That difference is the point — you already know which kind of night you are having.

## Why they share a workspace

Secrets, members, and billing are workspace-scoped. Support can see both tiles on Overview. The iOS app shows tests and monitors on the same home screen. You do not need a second vendor account to invite the person who answers customers.

<span data-pricing-amount="monthly">39 €</span> covers that pairing. Unlimited uptime, 300 browser runs, extra runs at <span data-pricing-amount="overage">0,20 €</span>. If you outgrow the ping side, add a specialist. If you outgrow the browser side, you are running a lot of hourly walks — which usually means the product is doing its job.
