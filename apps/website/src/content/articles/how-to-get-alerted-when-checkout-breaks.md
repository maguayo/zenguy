---
title: "How to get alerted when checkout breaks"
description: "One alert after retries fail, with the expected total and a screenshot — not a stream of red badges every five minutes."
pubDate: 2026-08-14
category: guide
tags:
  - alerts
  - checkout
  - incidents
related:
  - how-to-monitor-a-checkout-flow
  - failure-reports-for-ai-coding-agents
  - ci-passed-production-broke
  - best-tools-to-monitor-checkout
image: /articles/how-to-get-alerted-when-checkout-breaks.jpg
imageAlt: "A hand reaching for a phone glowing violet on a bed at 3 a.m., alarm clock beside it."
---

The failure mode of alerting is not “we didn't know”. It is “we turned it off”. Checkout watches die when they page people for a slow CDN blip.

Zenguy's rule is: **one alert when an incident opens, one when it recovers.** While it stays open, later failures join the timeline.

## Build the watch first

If you do not yet have a checkout test, start with [how to monitor a checkout flow](/articles/how-to-monitor-a-checkout-flow/). An alert without a real assertion is just a heartbeat.

The instruction must contain the number you would wake someone for:

> Check that the checkout total matches the cart total and is greater than 0 €. Do not place the order.

## Retries are the noise filter

Give the test three retries. Attempt 0 runs; retry 1 starts immediately; retry 2 waits a minute; retry 3 waits two. A flaky third-party script has to fail all of them before Slack lights up.

If a retry **passes**, the run is `PASSED` (shown as passed after retry). No incident. You still have the failed attempts for diagnosis.

## Pick channels like a small team, not like a NOC

Zenguy channels: email, Slack, Discord, iOS push (free with the app), SMS, WhatsApp, voice (pay as you go).

A sane default:

- **Slack or Discord** for everyone who might fix it;
- **iOS push** for the person who would actually get up;
- email as the archive;
- SMS / voice only if checkout being down is a true wake-up.

Voice reads the alert type and resource name — never a URL, never a secret.

Turn **notify on recovery** on. The second message is how you go back to sleep.

## What the message should contain

A useful checkout alert, like the one on the homepage:

> Checkout — production failed. Failed after 3 retries in 6 min 41 s. Order total showed 0,00 € instead of 149,00 €.

That is already enough to start. The run then has screenshots and a [Markdown report](/articles/failure-reports-for-ai-coding-agents/).

If your current tool only says “transaction check failed”, you will open it in the morning. The whole point of the watch is to open it now.

## Do not alert on every URL

Ping `/` separately. Do not make the checkout browser test also mean “the marketing site is slow”. Two incidents, two meanings.

## Test the path once

Zenguy can send a test notification. Prefer breaking staging on purpose and waiting for the real incident: you will see retries, grouping, and recovery in one afternoon, without training the team on a fake event.
