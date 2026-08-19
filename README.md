# Zenguy

Zenguy is a multi-tenant SaaS for natural-language browser testing and HTTP uptime monitoring, built as a Cloudflare-first monorepo with a Hono API, React application, and Astro landing site.

```text
zenguy/
├── apps/
│   ├── api/      # Cloudflare Worker API, queues, crons, and storage adapters
│   ├── web/      # React application
│   └── landing/  # Astro landing site
├── PROJECT.md
├── TASKS_BACKEND.md
└── TASKS_FRONTEND.md
```

See `apps/api/README.md` / `apps/web/README.md` for service-specific setup and
production deployment details.

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
pnpm --filter @zenguy/web dev

# Landing site — http://localhost:4321
pnpm --filter @zenguy/landing dev
```

The Vite application proxies `/api` to `http://localhost:8787`. To use an
alternate API port while another Wrangler process is running:

```bash
pnpm --filter @zenguy/api exec wrangler dev --port 8790
ZENGUY_API_ORIGIN=http://127.0.0.1:8790 \
  pnpm --filter @zenguy/web exec vite --host 127.0.0.1 --port 5174
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
| Email | `demo@zenguy.dev` |
| Password | `Password123!` |
| Workspace | `Demo Workspace` |

These credentials are for local development only. Do not reuse the password in
any deployed environment. If the demo workspace unexpectedly redirects to the
billing onboarding screen, rerun the local migration and seed commands above to
restore the deterministic fixture.

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

## Browser smoke test

After starting and seeding the services, use a clean browser session and check
the following flow:

1. Open the landing site at `http://localhost:4321` and verify the CTA and
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

- API unit tests: 528 passed across 81 files.
- Web unit tests: 180 passed across 61 files.
- API integration tests: 182 passed across 36 files.
- Total: 890 passed tests.
- Monorepo typecheck and production builds: passed.
- Cloudflare Email Sending: `zenguy.com` enabled in the personal account;
  Wrangler's remote `EMAIL` binding connected with
  `notifications@zenguy.com` as the only permitted sender.
- Browser smoke: landing, authentication, workspace modules, request testing,
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
