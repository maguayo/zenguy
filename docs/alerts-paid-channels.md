# Alerts: default email and pay-as-you-go SMS & calls

Last updated: 2026-08-22 · Design: `docs/superpowers/specs/2026-08-21-alerts-paid-channels-design.md`

## Product contract

- Every workspace gets a free, verified **Workspace email** channel to its
  owner when it is created (existing workspaces without channels are
  backfilled once by the hourly cron). Channels flagged *default* are
  preselected in new tests and monitors.
- Email, Slack and Discord alerts are always free.
- SMS, phone-call and WhatsApp channels are a **pay-as-you-go add-on**
  (`Alerts → SMS & calls`). They only deliver while the add-on is on and the
  workspace's **prepaid alert credit** covers the destination price. Credit can
  never go negative: an alert is charged before the provider call and refunded
  when the provider rejects it after the final retry.
- Guard-rails: one failure + one recovery alert per incident and channel
  (existing dedupe), a configurable limit of paid alerts per rolling 24 h
  (default 20, range 1–200), automatic pause at zero credit, and one email to
  the owner when the balance drops below €2 or an alert is skipped (reset by
  the next top-up).
- Members see the add-on state and prices; balance, history and top-ups are
  limited to `billing.view` / `billing.manage`.

## Prices

Source of truth: `apps/api/src/domain/alerts/pricing.ts`. Each priced country
stores Twilio's pay-as-you-go rate for our US long code, captured from the
public pages `twilio.com/en-us/sms/pricing/<cc>` (rate for "International /
Mobile numbers") and `twilio.com/en-us/voice/pricing/<cc>` (mobile rate billed
to a US/CA origination) on 2026-08-21. US and Canadian SMS include the highest
published carrier fee.

```
price_cents = max(minimum, ceil(twilio_usd × 2 × 100))   // USD treated as 1:1 EUR
minimum     = €0.05 per SMS, €0.20 per call
rest of world (any country not in the table) = €0.40 per SMS, €0.80 per call
```

Resulting examples: SMS US/CA €0.05 · Spain €0.18 · Germany €0.23 · France
€0.16 · UK €0.12 · Netherlands €0.23. Calls US/CA and most of Europe €0.20;
Poland €0.45; Netherlands €0.56; Greece €1.00; Latvia/Malta/Lithuania/Slovenia
€1.07–€1.33 (non-EEA origination surcharges).

Each alert costs exactly one unit: SMS bodies are trimmed to a single segment
(`domain/alerts/sms.ts`) and calls carry `TimeLimit=55` so Twilio bills one
minute. The TTS message is read twice inside that limit.

### Refreshing the table

1. Re-read the Twilio pages for every ISO code in `PRICED_COUNTRIES` and update
   `twilioSmsUsd` / `twilioCallUsd`; bump `PRICING_CAPTURED_ON`.
2. Run `pnpm --filter @zenguy/api test src/domain/alerts` — the tests assert
   every price stays above Twilio's cost and at or above the minimums.
3. Existing channels show the new price immediately (prices are computed, not
   stored); deliveries keep the price they were charged.

### Cost optimisation worth knowing

Calls from a US number to NL, PL, GR, the Baltics, SI, MT, LU, CH and CZ are
5–10× dearer than the same calls from an EEA number ("From EEA" rows on
Twilio's pages, e.g. NL mobile $0.0241 vs $0.2763). Buying a Spanish/EU voice
number for `TWILIO_FROM_CALL` would let most European call prices drop to the
€0.20 floor.

## Credit ledger

Tables (`apps/api/migrations/0019_alerts.sql`): `workspace_alert_settings`,
`alert_credit_balances` (never negative), `alert_credit_entries` (signed
ledger with a unique idempotency key: `charge:<deliveryId>`,
`refund:<deliveryId>`, `paddle_txn:<transactionId>`). Debits are a single D1
batch: `UPDATE … WHERE balance_cents >= ?` followed by an `INSERT … SELECT`
that only writes the ledger row when that UPDATE applied.

Deliveries store `cost_cents` and `destination_country`; skipped paid alerts
are `FAILED` with a readable reason (`Skipped: not enough alert credit (…)`,
`Skipped: daily limit of N paid alerts reached`, `Skipped: SMS & calls are
turned off for this workspace`) and the incident timeline shows it.

## Top-ups (Paddle)

Top-ups are one-time Paddle checkouts of 1–10 packs of €10
(`ALERT_CREDIT_PACK_CENTS`). To open them in an environment:

1. In the Paddle catalog create a non-recurring price "Zenguy alert credit
   pack" at EUR 10.00 (quantity 1–10) and copy its `pri_…` id.
2. Install it as the Worker secret/var `PADDLE_ALERT_CREDIT_PRICE_ID`
   alongside the existing `PADDLE_*` group. Sandbox and Live ids must never be
   mixed.
3. Subscribe the Paddle notification destination to `transaction.completed`
   (in addition to the subscription events). The webhook credits
   `quantity × €10` only for transactions whose `custom_data.purpose` is
   `alert_credit` and whose items contain the configured price; it is
   idempotent per transaction id and clears the low-balance notice.
4. Verify in staging with Paddle's sandbox cards: `Alerts → SMS & calls → Top
   up` opens the overlay; after `checkout.completed` the page polls the
   overview until the balance grows.

While `PADDLE_ALERT_CREDIT_PRICE_ID` is unset (production free launch), the
API reports `topUp.available = false`, `POST …/alerts/credit/topups` returns
503, and the SMS & calls switch cannot be turned on unless the workspace
already holds credit. Prices remain visible so teams can plan.

## API

| Method | Route | Permission |
|---|---|---|
| GET | `/api/workspaces/:id/alerts` | member (credit only with `billing.view`) |
| PATCH | `/api/workspaces/:id/alerts/settings` `{ paidChannelsEnabled?, dailyPaidAlertLimit? }` | `channels.manage` |
| GET | `/api/workspaces/:id/alerts/quote?phoneNumber=+34…` | member |
| GET | `/api/workspaces/:id/alerts/credit/entries?cursor&limit` | `billing.view` |
| POST | `/api/workspaces/:id/alerts/credit/topups` `{ packs }` | `billing.manage` |

Channel objects now carry `isDefault`, `price` (`{ cents, currency, destination }`
for paid types) and `paused` (`{ reason: "PAID_OFF" | "NO_CREDIT" }`); `PATCH
…/channels/:id` accepts `isDefault`. Creating or re-enabling a paid channel
while the add-on is off returns `400 VALIDATION_ERROR` on field `type` /
`enabled`. Deliveries carry `costCents` and `destinationCountry`.

## Operations checklist

- Staging seed (`pnpm --filter @zenguy/api seed`) turns the add-on on for the
  demo workspace with €5.00 of complimentary credit and priced SMS deliveries.
- Audit actions: `alerts.settings_updated`, `alerts.credit_topup`.
- Logs: `notification_delivery_skipped`, `alert_credit_refund_failed`,
  `alert_credit_notice_failed`, `alert_credit_topup_unmatched`,
  `default_email_channel_failed`, `default_channel_backfill_failed`.
- Follow-ups not built: complimentary alert-credit links for early adopters,
  an EU voice number, OTP verification of phone numbers, public pricing on the
  marketing site.
