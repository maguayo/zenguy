---
title: "Failure reports your coding agent can actually use"
description: "When production breaks, Zenguy writes a Markdown file of facts — not a guessed root cause — so you can paste it into Cursor, Claude, or a colleague."
pubDate: 2026-08-16
category: guide
tags:
  - reports
  - ai
  - incidents
related:
  - how-to-get-alerted-when-checkout-breaks
  - browser-tests-in-plain-english
  - ci-passed-production-broke
  - natural-language-browser-testing
image: /articles/failure-reports-for-ai-coding-agents.jpg
imageAlt: "Hands holding a printed failure report in front of a laptop with a code editor open."
---

Most monitoring tools emit a badge: red, “checkout failed”, a link that needs a login. A coding agent cannot do much with that. A junior engineer on a Sunday cannot either.

Zenguy writes a **Markdown failure report** for runs that end in `FAILED` or `TIMEOUT`. It is designed to be downloaded and forwarded. The homepage example is a file named like `checkout-production_8f2c1a_failure-report.md`.

## What is in the report

The file is a factual record:

- test name, run id, time;
- starting URL, device, viewport;
- the **exact instructions** that ran (a snapshot — later edits do not rewrite history);
- final status, duration, attempts;
- expected result vs observed result;
- steps, URLs, relevant console and network errors;
- pointers to screenshots;
- a note that secrets were redacted.

What it does **not** do: invent a root cause, propose a patch, or claim the price feed is guilty. Guessing is how you send an agent down a hole.

## Why Markdown

- It pastes into Slack, GitHub, Linear, and every coding agent.
- It diffs.
- It does not need Zenguy to be open in another tab to be useful (the screenshot URLs still need auth or a fresh signature, and they expire with the 30-day retention).

You can read a [sample report](/sample/checkout-production_8f2c1a_failure-report.md) without an account.

## A workflow that works

1. Alert arrives: “Order total showed 0,00 € instead of 149,00 €.”
2. Open the run. If it is obvious, fix it.
3. If it is not, download the Markdown. Paste it into the agent that already has the repo, with a prompt like: “This is a production watch failure. Do not invent a cause. List the files that could produce a 0,00 € checkout total, and the tests you would add.”
4. Keep the Zenguy report attached to the incident. When the next hourly run passes, recovery fires and you close it.

The agent is a reader of evidence, not a replacement for looking at the screenshot.

## Redaction is part of the format

Workspace secrets are write-only. They must not reappear in the report, the screenshot, or the log. If your instructions named a password in plaintext, that is on you — put it in Secrets and reference `{{SHOP_PASSWORD}}`.

Thirty days later the artifacts go away. If you need a longer audit, export the Markdown the day it fails.

## This is the product, not a flourish

Zenguy could have stopped at a red X. The reason to pay for a browser walk is the **story**: what it clicked, what it saw, what it expected. A coding agent is just the newest reader of that story. Support and engineering were the original ones.
