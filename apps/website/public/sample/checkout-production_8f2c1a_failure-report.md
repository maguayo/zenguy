# Failure report — Checkout — production

| | |
| --- | --- |
| Run | `8f2c1a` |
| Test | Checkout — production |
| Workspace | Acme Commerce |
| Viewport | Desktop · 1440 × 900 |
| Started | 2026-08-21 03:14:36 CEST |
| Finished | 2026-08-21 03:21:17 CEST (4 attempts · 6 min 41 s) |
| Verdict | **Failed** — final check did not pass on any attempt |

This report states what the agent did and saw. It does not guess a root cause.

## Expected

Cart and checkout totals match, and are greater than 0 €.

## Observed

The cart showed **149,00 €**. The checkout order summary showed **0,00 €**, on first read and
after a reload. Every page responded with HTTP 200.

## Steps (attempt 4 of 4)

| # | Time | Action | Result |
| --- | --- | --- | --- |
| 1 | 00:02 | Opened acme-shop.com | Landing page rendered, 200 |
| 2 | 00:09 | Clicked "Wireless headphones" | Product page rendered |
| 3 | 00:14 | Clicked "Add to cart" | Cart drawer opened, 1 item |
| 4 | 00:21 | Read cart total | Cart shows 149,00 € |
| 5 | 00:27 | Clicked "Go to checkout" | Navigated to checkout.acme-shop.com |
| 6 | 00:44 | Read order summary | Order total shows 0,00 € |
| 7 | 01:19 | Reloaded and re-read total | Order total still 0,00 € — **check failed** |

Screenshots for steps 1–5 and both reads of the order summary are attached to the run:
`step-1.png` … `step-7.png`.

## Console around the failure

```
03:15:52  error  TypeError: Cannot read properties of undefined (reading 'amount')
                 at OrderSummary (checkout.bundle.js:1:48211)
03:15:52  warn   price-feed: empty payload, rendering defaults
```

## Network around the failure

| Time | Request | Status | Size |
| --- | --- | --- | --- |
| 03:15:51 | GET checkout.acme-shop.com/api/prices?cart=[sanitised] | 200 | 0 B |
| 03:15:51 | GET checkout.acme-shop.com/api/cart?id=[sanitised] | 200 | 2.1 kB |
| 03:15:52 | POST checkout.acme-shop.com/api/telemetry | 204 | — |

Query strings are sanitised. Response and request bodies are never stored.

## Attempts

| Attempt | Started | Duration | Outcome |
| --- | --- | --- | --- |
| 1 | 03:14:36 | 1 min 22 s | Failed — order total 0,00 € |
| 2 | 03:16:03 | 1 min 34 s | Failed — order total 0,00 € |
| 3 | 03:18:12 | 1 min 41 s | Failed — order total 0,00 € |
| 4 | 03:19:58 | 1 min 19 s | Failed — order total 0,00 € |

One incident was opened at 03:21:17 and alerts were sent to the channels configured for this
test. Recovery will close the incident and notify the same channels.

---

Secret values are redacted in every screenshot, report and log. This sample uses demo data
from the Zenguy homepage story.
