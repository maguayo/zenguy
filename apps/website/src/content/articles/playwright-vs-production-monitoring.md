---
title: "Playwright vs production monitoring"
description: "Playwright proves the merge. It cannot see DNS, Stripe, or a price feed at 03:14. That is a different job — and a different kind of test."
pubDate: 2026-08-21
category: comparison
tags:
  - playwright
  - ci
  - production monitoring
related:
  - ci-passed-production-broke
  - checkly-alternative
  - browser-tests-in-plain-english
  - what-is-synthetic-monitoring
---

Playwright is the right tool for testing **your code**, in **your pipeline**, on **your infrastructure**, before it ships.

It is the wrong tool to answer “is production still usable right now?”, unless you deliberately turn those tests into synthetic monitors (Checkly, Datadog, a cron on a runner you own). Even then, you are operating a Playwright estate.

Zenguy is not a Playwright replacement. It is the watch that starts after the merge.

## What Playwright is for

Playwright gives engineers:

- deterministic browsers in CI;
- selectors, fixtures, traces;
- the ability to mock APIs, freeze time, stub payments;
- a failing build that **blocks a deploy**.

That last point is the point. CI is a gate. A green Playwright suite means: *this commit, in this environment, with these mocks, did the things we asserted.*

It does not mean:

- yesterday's deploy is still healthy;
- the third-party price feed still returns numbers;
- Shopify checkout, Stripe, or an IdP still accept the next customer;
- DNS, certificates, a feature flag, or a CDN rule did not change under you;
- mobile Safari-sized viewports on the live site still show the pay button.

Those things break **after** CI, on systems you do not compile.

## What production monitoring is for

Production monitoring — synthetic monitoring, outside-in checks, Zenguy's browser tests — answers a different question: *can a real user complete this path on the live site, right now?*

The environment is hostile on purpose. No mocks. Real DNS. Real third parties. Real cookies, until you log in with a staging account. Real “the homepage is 200 and the total is 0,00 €”.

You do not want this in CI as the only gate. You want it on a schedule, with retries so a blip does not page you, and with evidence so the 03:21 alert is enough to start a fix.

## Side by side

| | Playwright in CI | Zenguy in production |
|---|---|---|
| When it runs | On each commit / PR | Every 1–24 hours, or on demand |
| Where | Your runners, usually | Zenguy's isolated Chrome |
| Auth against | Local / staging, often mocked | The live (or staging) site you name |
| Failure mode | Red build, blocked merge | Incident + alert + screenshots |
| Who writes it | Engineers | Anyone who can describe the path |
| Selectors | Yes | No |
| Third parties | Usually stubbed | Really hit, including other domains |

## Keep both

Most teams that adopt Zenguy should **keep Playwright**.

Use Playwright to:

- assert component behaviour;
- catch regressions you own;
- run on every pull request.

Use Zenguy to:

- walk checkout, login, and onboarding on the deployed site;
- notice the failure a mock would have hidden;
- send a Markdown report to the person — or the agent — who will fix it.

Checkly exists for the team that wants Playwright **as** the production monitor. That is a valid third option if the same spec files should run in both places. See [Checkly alternative](/articles/checkly-alternative/) for that fork.

## Why English instead of a spec

Production watches rot when they are coupled to class names. A marketing hero rewrite should not require a pull request to keep the checkout monitor alive.

Zenguy's tests are goals. “The cart contains the product and the total matches the price.” If the DOM changes and the goal still holds, the test should still pass. If the total is wrong, it should fail with a picture of the total.

That is a worse unit-test. It is a better night watch.

## A concrete split of labour

- **Playwright:** “Add to cart updates the badge in the test store with Stripe mocked.”
- **Zenguy:** “On production, add this product, check the total, open checkout, check it again, do not pay.”

When the second one fails at 03:14 and CI is green, you have the story this site is built around. Thirteen hours is how long that story lasts if nobody walks the path.
