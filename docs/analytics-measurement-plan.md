# Zenguy measurement plan

Last updated: 2026-08-30

## Measurement architecture

- GA4 property: `Zenguy — Production` (`552095832`)
- Web stream: `Zenguy Web — Production` (`G-P2HSMZMWVB`)
- Reporting time zone: `Europe/Madrid`
- Currency: EUR
- Reporting identity: Observed (purpose-specific consented User-ID, then device ID)
- First-party product source of truth: D1 `activity_events`
- Billing source of truth: Stripe-backed billing records

One GA web stream covers `zenguy.com`, `www.zenguy.com`, and
`app.zenguy.com`. The journey is separated with `Hostname`, `surface`,
`content_group`, and `app_section`, not with separate web streams.

GA uses Basic Consent Mode. Therefore every GA user metric means **users who
accepted analytics on that origin**. It must never be presented as the total
number of Zenguy users. Exact authenticated-account usage comes from D1 and is
not consent-dependent.

## Canonical metrics

| Metric | Definition | Source | Main cuts |
| --- | --- | --- | --- |
| Product DAU | Distinct authenticated `user_id` with a human activity event during a Europe/Madrid calendar day | D1 `activity_events` | `source=web\|app`, event family |
| Product WAU / MAU | Distinct authenticated `user_id` in the current 7 / 30 Europe/Madrid calendar days | D1 `activity_events` | `source=web\|app` |
| Product stickiness | Product DAU / Product MAU for the same end date and filters | D1 | `source` |
| Product visits per active user | Allow-listed authenticated page/screen visits / distinct active accounts in the selected window | D1 | `source=web\|app` |
| Public-site users | GA Active users filtered to `surface=public_web` | GA4, consented population | hostname, landing page, content group, campaign |
| Web-app users | GA Active users filtered to `surface=web_app_authenticated` | GA4, consented population | app section, role, subscription status |
| Views per user | Views / Active users for the same surface and period | GA4, consented population | surface, content group, app section |
| Sessions per user | Sessions / Active users for the same surface and period | GA4, consented population | surface, landing, campaign |
| Engagement | Average engagement time per active user and engagement rate | GA4, consented population | surface, landing, app section |
| CTA rate | Sessions containing `cta_click` / sessions beginning on the same public landing | GA4, consented population | CTA location, landing, campaign |
| Verified registration conversion | Users with `sign_up` / users who reached the signup journey, for the same window and campaign | GA4, consented population; D1 registrations authoritative | source / medium / campaign / content |
| Checkout conversion | Users with `begin_checkout` / users with `sign_up`, for the same window | GA4 directional; D1/backend authoritative | campaign, role/status |
| Paid conversion and revenue | Confirmed active subscriptions and paid invoices | Backend / Stripe | acquisition only directionally from GA `purchase` |

Automated test runs and scheduled uptime checks are not human product activity
and must not inflate Product DAU or visits per active user.

The internal admin dashboard exposes Product DAU, WAU, MAU, DAU/MAU,
range-active accounts and visits per active account, with a daily series and
separate Web and native App rows. The Total row deduplicates an account that
used both sources. Mutations currently arrive with `source=server`, so the
dashboard deliberately does not publish a misleading human-actions-by-client
metric until client attribution is reliable.

## GA taxonomy

Built-in dimensions:

- `Hostname`: public hosts versus app host.
- `Landing page`: session entry page.
- `content_group`: `public_home`, `public_landing`, `public_content_hub`,
  `public_article`, `public_legal`, `app_auth`, `app_onboarding`, `app_product`,
  `app_billing`, `app_legal`, or `error`.
- Source, medium, campaign, and campaign content: accepted only from a strict,
  finite UTM catalog while page URLs remain query-free. Unknown benign required
  values collapse to `other`; malformed, incomplete, duplicate, token-like or
  identifier-like campaigns are dropped. Add new business campaign labels to
  the catalog deliberately before launch.

Registered event-scoped custom dimensions:

- `surface`: `public_web`, `web_app_public`, `web_app_authenticated`
- `app_section`
- `auth_state`
- `route_pattern`
- `workspace_role`
- `subscription_status`
- `cta_location`
- `cta_destination`

Registered user-scoped custom dimensions:

- `account_age_bucket`
- `workspace_count_bucket`

Never register or send email, name, workspace/resource identifiers, internal
user identifiers, free-text URLs, form contents, instructions, secrets, or
tokens as analytics dimensions. GA `user_id` is purpose-specific, derived in
the browser from the opaque internal account identifier, and is not registered
as a custom dimension.

## Standard report filters

- Public marketing: `surface exactly matches public_web`
- Public app/auth journey: `surface exactly matches web_app_public`
- Authenticated web product: `surface exactly matches web_app_authenticated`
- A landing: `Landing page` plus `content_group`
- A product area: authenticated surface plus `app_section`
- Paying workspace behavior: authenticated surface plus
  `subscription_status=active`

Use GA for acquisition and consented behavior. Use D1 for exact account counts,
retention, and product usage; use Stripe/backend data for money.

The public hosts use host-only analytics cookies and separate consent storage.
Until the production `www.zenguy.com` → `zenguy.com` canonical redirect is
verified, keep `Hostname` in public reports and do not add the two host-level
unique-user counts together as though they were deduplicated people.

Only `sign_up` (after successful email verification) and `purchase` are GA key
events. `cta_click` and `begin_checkout` remain ordinary diagnostic funnel
events so the aggregate key-event metric is not dominated by microconversions.

## Operational checks after deployment

1. Confirm zero Google requests before analytics consent on each origin.
2. Accept version 2 consent and verify one sanitized `page_view` in Realtime.
3. Verify `surface`, `content_group`, and app dimensions contain only listed
   values and no concrete ids.
4. Test a public CTA with a safe UTM campaign through successful registration.
5. Confirm a signed-in consented account is deduplicated across two browsers,
   while signing out clears `user_id` for later public events.
6. Compare GA's consented web-app Active users with D1 Product DAU; differences
   are expected and should be labelled, not reconciled by changing definitions.

Custom definitions normally take 24–48 hours to become available in reports.
No historical event data is backfilled into a newly created custom definition.
