---
title: "Your CI passed. Production still broke."
description: "A green pipeline proves the commit. It does not prove DNS, Stripe, a flag, or a price feed. Production needs a second kind of test."
pubDate: 2026-08-21
category: guide
tags:
  - ci
  - production
  - playwright
related:
  - playwright-vs-production-monitoring
  - why-http-200-is-not-enough
  - what-is-synthetic-monitoring
  - how-to-get-alerted-when-checkout-breaks
image: /articles/ci-passed-production-broke.jpg
imageAlt: "Two monitors at night: a green CI pipeline on the left, a failing checkout on the right."
---

CI is a gate on **change**. Production monitoring is a watch on **reality**.

Teams collapse the two because both involve browsers and assertions. Then they are surprised when the suite is green and the store is not.

## What CI cannot see

Your pipeline runs in a network you control, against fixtures you own, often with payments stubbed and third parties mocked. That is correct for a unit of code.

After the merge, the live site is attached to:

- DNS and certificates you renewed six months ago;
- a CDN cache that still holds the last broken bundle;
- a feature flag flipped in a dashboard, not in git;
- a Shopify / Stripe / Auth0 page you do not compile;
- a partner feed that returns empty at 03:14;
- a mobile viewport nobody ran in CI tonight.

Playwright in CI is allowed to miss all of that. It is not a moral failure. It is the wrong instrument.

## The thirteen-hour gap

A typical incident we designed the product around:

1. Afternoon: merge approved, 214 tests pass, deploy succeeds, health checks stay 200.
2. Night: checkout totals become 0,00 €. Every request is still 200.
3. Morning: a customer asks whether the sale is meant to be free.

Nothing in CI was lying. Nothing in uptime was lying. Nothing was watching the **path**.

## What to add, not what to replace

Keep CI. Add a production walk of the two or three paths that hurt.

Properties of a useful production test:

- hits the **deployed** URL;
- uses a **staging customer**, never a real card;
- asserts **business facts** (totals, emails, “you are logged in”), not class names if you can help it;
- runs **whether or not anyone shipped today**;
- retries before it pages;
- leaves evidence a human can forward.

You can do this with Playwright on a cron (or Checkly). You can do it with Zenguy in English. The important part is that it exists at all.

## Why English helps after midnight

At 03:21 the on-call is often not the author of `checkout.spec.ts`. A Markdown report that says:

- expected: order total 149,00 €
- observed: order total 0,00 €
- screenshot of the summary
- the six clicks that got there

is a better page than a stack of selector timeouts. You can paste it into a coding agent. You can send it to the person who owns the price feed.

## A policy that fits a small team

- CI must stay green to merge.
- Zenguy (or your synthetic of choice) must stay green to *sleep*.
- A CI pass never closes an open production incident.
- A production fail never means “write more unit tests” as the only action. Look at the third party.

The homepage line is the policy in one sentence: *Your tests prove the merge was fine. This proves production still is.*
