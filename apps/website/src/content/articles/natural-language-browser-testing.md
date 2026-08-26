---
title: "Natural language browser testing"
description: "Natural language tests describe a goal, not a selector. They belong in production watches, next to Playwright, not instead of engineering tests."
pubDate: 2026-08-17
category: guide
tags:
  - natural language
  - browser tests
  - qa
related:
  - browser-tests-in-plain-english
  - playwright-vs-production-monitoring
  - what-is-synthetic-monitoring
  - failure-reports-for-ai-coding-agents
---

Natural language browser testing means the artifact you maintain is a **goal in English** (or whatever language you write), and a model-driven agent operates a real browser to prove or disprove that goal.

It is having a moment because selectors are a tax, production is full of third parties, and coding agents are now downstream consumers of failure reports.

It is not a license to delete your test suite.

## What the sentence is for

A sentence is a good interface when:

- the author is not the person who would enjoy Playwright;
- the UI moves faster than the test file;
- the valuable assertion is a **business fact** (“the total matches the price”);
- the path crosses domains you do not compile.

A sentence is a bad interface when:

- you need a pixel-perfect visual regression;
- you need the same file to gate every pull request;
- you need millisecond-deterministic mocks;
- you need to assert 200 independent properties in one run.

Zenguy is built for the first list, in production, on a schedule.

## How Zenguy uses the sentence

The instructions go to an isolated Chrome session with a hard timeout. The agent must **check**, not just click. Success is “the cart contains the product and the total is 149,00 €”, not “I pressed Add”.

That is why the failure is readable: expected vs actual is copied out of the goal you wrote.

## Compared with no-code recorders

Recorders store clicks. English stores intent.

When a button moves from the header to a drawer, a recorder breaks. An agent that was told “add the product to the cart and check the total” can often still succeed. When the total is wrong, both should fail — and the English test fails with a picture of the total, not “element not found”.

Recorders still win on short, stable, internal forms if you already own one. They lose on Shopify + Stripe + a cookie banner.

## Compared with LLM demos

A public demo that “controls a browser” is not a monitor. A monitor needs:

- a schedule;
- retries and incidents;
- redaction of secrets;
- retention limits;
- a bill you can explain;
- an output a colleague can open at 03:21.

Zenguy is the boring version of the demo: same idea, production constraints.

## How to write goals the agent can honour

- Put **observables** in the text: headings, prices, counts, URLs, error banners.
- Put **stops** in the text: “do not pay”, “do not delete”.
- Put **identity** in secrets, not in the paragraph.
- One flow per test. Login is not also checkout is not also settings.

Then keep Playwright for the code you own. Natural language does not replace engineering tests. It replaces the hope that engineering tests saw production.
