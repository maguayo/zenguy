# Zenguy

Zenguy is a multi-tenant SaaS for natural-language browser testing and HTTP uptime monitoring, built as a Cloudflare-first monorepo with a Hono API, React application, and Astro public website.

## What Zenguy does

Zenguy watches web applications from the outside, the way a real user
experiences them, and alerts the team when something breaks.

- **Browser tests written in plain language.** A test is a start URL plus
  written instructions such as "Check that the page shows the heading
  'Example Domain' and contains a link labeled 'More information'". An
  LLM-driven agent (OpenAI `gpt-5-mini` by default) executes those
  instructions in a real headless browser through Cloudflare Browser
  Rendering, on desktop or mobile viewports, on a schedule or on demand,
  with automatic retries. Every run keeps its verdict, expected versus
  actual result, step timeline, screenshots, visited URLs, and
  console/network summaries.
- **HTTP uptime monitoring.** Scheduled checks against any endpoint with a
  configurable method, encrypted headers and body, expected status code,
  optional response-body conditions, timeouts, and retries.
- **Incidents and alerting.** Consecutive failures open an incident with an
  event timeline; recovery closes it. Failure and recovery alerts fan out to
  per-workspace notification channels: email, SMS, WhatsApp, voice call,
  Slack, and Discord.
- **Team workspaces.** Workspaces with `OWNER`/`ADMIN`/`MEMBER` roles, email
  invitations, an audit log of sensitive actions, and encrypted workspace
  secrets that runs may use against allow-listed domains while the plaintext
  is never shown again.
- **Usage-based billing.** Paddle subscription at EUR 39 per month with 300
  browser runs included and EUR 0.20 per additional run, with per-cycle
  usage tracking and durable, replay-safe overage reporting. Allow-listed
  issuer accounts can also mint single-use complimentary subscription
  grants that activate a workspace without Paddle.
- **Read-only public API.** Per-workspace API keys expose workspace,
  uptime-monitor, browser-test, and run data over a rate-limited read-only
  REST API.

## Repository layout

```text
zenguy/
├── apps/
│   ├── api/      # Cloudflare Worker API, queues, crons, and storage adapters
│   ├── frontend/ # React application
│   └── website/  # Astro public website
├── PROJECT.md
├── TASKS_BACKEND.md
└── TASKS_FRONTEND.md
```

See `apps/api/README.md` / `apps/frontend/README.md` for service-specific setup and
staging and production deployment details.

## Deployment architecture and current status

Cloudflare Pages owns each application hostname and serves the Vite build.
Cloudflare Worker Routes intercept only `/api/*` on those same hostnames, so the
browser can keep using relative API URLs and same-origin secure cookies. The API
Worker does not serve frontend assets and does not own either full hostname.

| Environment | Git branch | Pages project | Pages root | Application URL | API Worker route | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Staging | `staging` | `zenguy-frontend-staging` | `apps/frontend` | `https://staging-app.zenguy.com` | `staging-app.zenguy.com/api/*` → `zenguy-api-staging` | Operational |
| Production | `main` | `zenguy-frontend` | `apps/frontend` | `https://app.zenguy.com` | Target: `app.zenguy.com/api/*` → `zenguy-api-production` | Isolated bootstrap; activation pending |

The environments use independent D1, KV, R2, Queue, secret, and provider
configuration. Staging is deployed with Paddle Sandbox. Production resources,
migrations, and an unreachable bootstrap Worker are prepared; that Worker has
no public route, cron trigger, or Queue consumer. Production remains inactive
until Paddle Live credentials and catalog, Twilio production
credentials/senders, the signed Paddle Live webhook, and the final Worker
activation are complete. Deployed
environments send transactional email through Cloudflare Email Service on
`zenguy.com` and use the low-cost OpenAI `gpt-5-mini` model by default. No
Anthropic integration is required.

## Local development

Requirements:

- Node.js 22 or newer.
- `pnpm`.
- A populated, ignored `apps/api/.dev.vars` file. Start from
  `apps/api/.dev.vars.example`; never commit API keys or provider secrets.

Install dependencies, prepare the local database, and load the deterministic
demo fixture:

```bash
pnpm install
pnpm --filter @zenguy/api db:migrate:local
pnpm --filter @zenguy/api seed
```

Start each service in its own terminal:

```bash
# API — http://localhost:8787
pnpm --filter @zenguy/api dev

# React application — http://localhost:5173
pnpm --filter @zenguy/frontend dev

# Public website — http://localhost:4400
pnpm --filter @zenguy/website dev
```

The Vite application proxies `/api` to `http://localhost:8787`. To use an
alternate API port while another Wrangler process is running:

```bash
pnpm --filter @zenguy/api exec wrangler dev --port 8790
ZENGUY_API_ORIGIN=http://127.0.0.1:8790 \
  pnpm --filter @zenguy/frontend exec vite --host 127.0.0.1 --port 5174
```

Confirm the API before testing the UI:

```bash
curl --fail --show-error http://localhost:8787/api/health
```

## Local test account

Running the seed command creates this reusable account and workspace:

| Field | Value |
| --- | --- |
| Sign-in URL | `http://localhost:5173/signin` |
| Email | `marcos@aguayo.es` |
| Password | `abc123456` |
| Workspace | `Aguayo Staging` |

These credentials are the local and staging fixture only. Do not use them in
production. A commit to the `staging` branch wipes staging application data and
recreates this fixture. If the workspace unexpectedly redirects to billing
onboarding, rerun migrate + seed.

## Paddle sandbox checkout

Use only Paddle's published test cards in the sandbox checkout. Never enter a
real card number in the sandbox.

### Successful payment without 3DS

| Field | Value |
| --- | --- |
| Card number | `4242 4242 4242 4242` |
| Expiration | Any future date, for example `12/30` |
| Security code | `100` |
| Name on card | Any test name |
| Country and postal code | Any valid supported values |

Additional scenarios:

| Scenario | Card number |
| --- | --- |
| Successful Visa debit | `4000 0566 5566 5556` |
| Successful payment with 3DS | `4000 0038 0000 0446` |
| Declined payment | `4000 0000 0000 0002` |
| Initial success, subsequent decline | `4000 0027 6000 3184` |

See Paddle's official
[sandbox card documentation](https://developer.paddle.com/concepts/payment-methods/card/)
for the current list. Sandbox and live credentials, price IDs, customers, and
transactions are separate.

### Local checkout activation

Completing the Paddle overlay does not activate a workspace directly from the
browser. Zenguy provisions the subscription only after its API receives a
signed Paddle webhook at `POST /api/webhooks/paddle`.

Paddle cannot deliver webhooks to `localhost`. For a full local checkout test,
expose the local API through a public HTTPS tunnel and create a Paddle sandbox
notification destination for:

```text
https://<public-api-host>/api/webhooks/paddle
```

Subscribe that destination to the `subscription.created`,
`subscription.updated`, `subscription.canceled`, and `subscription.past_due`
events. Put that destination's endpoint secret in `PADDLE_WEBHOOK_SECRET`, then
restart the API before testing checkout.

If the UI remains on `Activating…` after a successful sandbox payment, do not
pay again. First confirm the subscription in Paddle Sandbox, make the webhook
destination reachable, and replay its `subscription.created` notification.
The UI polls for up to two minutes and then presents `Check again`; once the
signed notification has been processed, that action completes onboarding.

### Overage billing safety

The server-side Paddle API key used for overage billing must include
`price.read`, `subscription.write`, and `transaction.read`. Zenguy validates
that `PADDLE_OVERAGE_PRICE_ID` is exactly EUR 0.20 with no country-specific
overrides before requesting a charge.

An ended billing period is not settled until one hour after its actual
`period_end`. The pending period and its durable overage report both pin the
original Paddle subscription ID, so a later subscription replacement cannot
redirect the charge. Before its single permitted charge request, the report is
persisted as `AMBIGUOUS`; if the request outcome cannot be proved, subsequent
runs only reconcile the deterministic marker against Paddle and emit a
sanitized operator log. They never repeat the charge request.

## Provider configuration for testing

- Cloudflare commands for this repository must run through the
  `zenguy-personal` Wrangler profile. From `apps/api`, `wrangler whoami` must
  report `marcosaguayomora@gmail.com` before creating, changing, or deploying
  any Cloudflare resource. The profile is directory-scoped, so other saved
  Wrangler accounts are not selected by this project.
- Keep `PADDLE_ENVIRONMENT=sandbox` locally.
- Transactional email uses Cloudflare Email Service through the Worker's
  `EMAIL` binding. Local Wrangler uses a remote binding, so signup, password
  reset, invitation, and email-channel messages are delivered to real inboxes.
- The development sender is
  `Zenguy <notifications@zenguy.com>`. The sending domain must remain
  enabled in the connected Cloudflare account before starting the API.
- Zenguy uses the OpenAI Responses API and defaults to the low-cost
  `gpt-5-mini` model through `LLM_MODEL=gpt-5-mini`.
- No Anthropic credential is required or used.
- Keep `OPENAI_API_KEY`, Paddle credentials, cryptographic keys, and all other
  secrets in the ignored `apps/api/.dev.vars` file. Do not copy their values
  into this README, source files, screenshots, or test reports.
- Remote email bindings send real transactional messages during local
  development. Use only inboxes you control.

To create or repair the directory-scoped Cloudflare profile:

```bash
pnpm --filter @zenguy/api exec wrangler auth create zenguy-personal
pnpm --filter @zenguy/api exec wrangler auth activate zenguy-personal
pnpm --filter @zenguy/api exec wrangler whoami
```

The final command must show `Active profile: zenguy-personal` and the expected
personal email before continuing.

## Staging and production releases

Pages deploys the frontend automatically from Git. The staging Pages project
tracks `staging`; the production project tracks `main`. Both use
`apps/frontend` as the root directory, `pnpm build` as the build command, and
`dist` as the output directory.

The staging backend CI configuration is prepared but is not connected yet
because the existing Workers Builds token lacks required permissions. Until a
correctly scoped token is installed,
an API push does not deploy the Worker automatically; use the explicit
migration and deploy commands below. Production automation must remain disabled
until its Paddle Live, Twilio, webhook, and secret release gates are satisfied.

Apply the matching D1 migrations before deploying an API environment:

```bash
# Staging
pnpm --filter @zenguy/api db:migrate:staging
pnpm --filter @zenguy/api deploy:staging

# Production bootstrap only: creates an unreachable Worker with no event sources
pnpm --filter @zenguy/api deploy:production:bootstrap

# Final production release: run only after every Live-provider gate is satisfied
pnpm --filter @zenguy/api db:migrate:production
pnpm --filter @zenguy/api deploy:production
```

`deploy:production` activates the `/api/*` route, cron triggers, and Queue
consumers. Never run it merely to create the Worker or to test Sandbox
credentials; use `deploy:production:bootstrap` for that safe preparation step.

Cloudflare resources are deliberately isolated:

| Binding | Staging | Production |
| --- | --- | --- |
| D1 | `zenguy-staging-db` | `zenguy-db` |
| KV | `zenguy-staging-kv` | `zenguy-kv` |
| R2 | `zenguy-staging-artifacts` | `zenguy-artifacts` |
| Run Queue / DLQ | `zenguy-staging-runs` / `zenguy-staging-runs-dlq` | `zenguy-runs` / `zenguy-runs-dlq` |
| Check Queue / DLQ | `zenguy-staging-checks` / `zenguy-staging-checks-dlq` | `zenguy-checks` / `zenguy-checks-dlq` |
| Notification Queue / DLQ | `zenguy-staging-notify` / `zenguy-staging-notify-dlq` | `zenguy-notify` / `zenguy-notify-dlq` |

Do not point a production binding at a staging resource, copy sandbox Paddle
IDs into production, or commit any secret. The full secret, migration, route,
and webhook procedure is in `apps/api/README.md`; the exact Pages settings are
in `apps/frontend/README.md`.

## Browser smoke test

After starting and seeding the services, use a clean browser session and check
the following flow:

1. Open the public website at `http://localhost:4400` and verify the CTA and
   responsive layout.
2. Sign in with the local test account.
3. Verify Overview usage, browser-test, uptime, incident, and recent-activity
   cards.
4. Open Browser Tests, a test detail, and a completed run. Check status,
   attempts, screenshots, visited URLs, console/network summaries, and the
   `gpt-5-mini` model label.
5. Open Uptime, a monitor detail, and its recent checks. From the edit screen,
   `Send test request` should return HTTP 200 for the seeded example monitor
   without consuming a browser run.
6. Check resolved Incidents and their failure/recovery notification timeline.
7. Check Notifications and its delivery drawer. Do not send a test notification
   to a real address.
8. Check that Secrets lists metadata but never reveals stored plaintext values.
9. Check Members, role controls, Usage & Billing, Workspace Settings, and the
   audit log. Do not exercise payment cancellation, ownership transfer, or
   deletion against shared data.
10. Repeat the primary navigation at `390 × 844`. Verify the navigation drawer,
    focus return on Escape, internal table scrolling, zero document-level
    horizontal overflow, and keyboard activation of table rows.
11. In a signed-out session, verify sign-in, signup validation, forgot/reset
    password, invalid verification/invitation states, and the 404 page.
12. Finish with an empty browser console. Expected API responses during the
    signed-out checks include `401` for refresh and `410` for an expired or
    invalid invitation.

Browser tests and notification tests may consume provider resources or send
messages. Use sandbox recipients and staging targets, and do not click payment,
subscription cancellation, deletion, or ownership-transfer confirmations as
part of a read-only smoke test.

## Automated verification

Run all unit tests, type checks, builds, and the Worker integration suite:

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm --filter @zenguy/api test:integration
```

Last local verification on 2026-08-19:

- API unit tests: 543 passed across 81 files.
- Web unit tests: 180 passed across 61 files.
- API integration tests: 185 passed across 36 files.
- Total: 908 passed tests.
- Monorepo typecheck and production builds: passed.
- Cloudflare Email Sending: `zenguy.com` enabled in the personal account;
  Wrangler's remote `EMAIL` binding connected with
  `notifications@zenguy.com` as the only permitted sender.
- Browser smoke: public website, authentication, workspace modules, request testing,
  responsive layout, keyboard navigation, and console inspection passed.
- No real email was sent during verification; perform an inbox smoke only with
  an explicitly approved recipient address.

### Local troubleshooting notes

- If sign-in shows `Request failed`, check `/api/health` and stop any stale
  Wrangler process occupying port 8787 before restarting the API.
- Paddle invoice retrieval is provider-backed. If Billing shows no invoices,
  inspect Wrangler logs for `billing_invoice_list_failed` before concluding
  that the workspace has no Paddle invoices.
- Wrangler local mode does not reproduce every remote Queue and Browser
  Rendering behavior. Follow the hybrid/deployed development guidance in
  `apps/api/README.md` for an end-to-end Browser Rendering run.
