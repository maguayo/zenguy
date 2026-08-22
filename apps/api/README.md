# Zenguy API

Zenguy's backend is a Hono application on Cloudflare Workers. It provides
authentication, workspace RBAC, browser-run queueing and result ingestion,
uptime monitoring, notifications, billing, encrypted secrets, reports, and
operational cleanup. Browser and model execution live in the separate local
Python worker under `runner/`.

## Prerequisites

- Node.js 22 or newer and pnpm.
- A Cloudflare account authenticated with Wrangler.
- Workers Paid for the deployed environments. Zenguy relies on Queues, D1,
  R2, KV, and Cloudflare Email Service.
- Provider accounts described below.

All commands in this document run from the repository root unless a section
says otherwise.

## Local development

Install dependencies and create the ignored local secrets file:

    pnpm install
    cp apps/api/.dev.vars.example apps/api/.dev.vars

Replace every placeholder in apps/api/.dev.vars. Generate independent values
for the four local cryptographic/runner secrets:

    openssl rand -hex 32
    openssl rand -base64 32
    openssl rand -hex 32
    openssl rand -hex 32

Use those outputs for JWT_SECRET, ENCRYPTION_KEY, ARTIFACT_URL_SECRET, and
RUNNER_API_TOKEN, respectively. Keep apps/api/.dev.vars out of source control.
`LLM_MODEL` records the requested local model in each immutable run snapshot.
The one-command Python worker fixes the matching Bionic model locally.

Apply migrations, load the deterministic demo fixture, and start the API:

    pnpm --filter @zenguy/api db:migrate:local
    pnpm --filter @zenguy/api seed
    pnpm --filter @zenguy/api dev

The API listens on http://localhost:8787 and its health endpoint is
http://localhost:8787/api/health.

The API never consumes `RUN_QUEUE` and never launches a browser. Run the
external Python worker described in `../../runner/README.md` against the
staging or production Queue HTTP pull endpoint for the complete path. Local
Wrangler remains useful for API/UI work, but its local Queue is not the remote
HTTP pull queue.

The frontend has no runtime environment variables. Run it in a second terminal:

    pnpm --filter @zenguy/frontend dev

Its Vite server listens on http://localhost:5173 and proxies /api to
http://localhost:8787. See TASKS_FRONTEND.md and apps/frontend/README.md for the
frontend-owned setup.

### Seed data

The seed command recreates an idempotent fixture in local D1:

- Login: `marcos@aguayo.es` / `abc123456`
- Workspace: Aguayo Staging, with admin and member teammates
- Complimentary (non-Paddle) active subscription
- Browser tests, completed runs, and uptime monitors ("beats")
- DEMO_TOKEN secret restricted to example.com

Preview the SQL without executing it:

    pnpm --filter @zenguy/api seed -- --dry-run

Remote seeding is supported only for the isolated staging D1 database. It
requires the explicit staging environment and both confirmation flags:

    pnpm --filter @zenguy/api seed -- --remote --env staging --allow-remote --confirm-staging

The script hardcodes `zenguy-staging-db` for that remote form and rejects any
other environment. It never executes a remote seed against `zenguy-db` or
production. Preview the exact Wrangler command without executing or generating
SQL with:

    pnpm --filter @zenguy/api seed -- --print-command --remote --env staging --allow-remote --confirm-staging

## Workspace API keys and the public read API

Workspaces can create API keys so external apps and dashboards consume
workspace data programmatically. Keys are managed from the session-based API
(OWNER or ADMIN; any member can list) and grant read-only access:

    POST   /api/workspaces/{workspaceId}/api-keys      { "name": "Status dashboard" }
    GET    /api/workspaces/{workspaceId}/api-keys
    DELETE /api/workspaces/{workspaceId}/api-keys/{apiKeyId}

The create response includes the full key (format `zgk_…`) exactly once; only
its SHA-256 hash is stored, and the list endpoint exposes just the display
prefix, creator, and last-used timestamp. A workspace can hold at most 20
active keys. Creation requires an active subscription; revocation never does,
so a leaked key can always be disabled. Both actions are audit-logged.

A key authenticates the public read-only surface under `/api/v1`, sent as
`Authorization: Bearer zgk_…` or `X-Api-Key: zgk_…`:

    GET /api/v1/workspace                        # identify the key's workspace
    GET /api/v1/uptime-monitors                  # monitors with current status
    GET /api/v1/browser-tests                    # tests with their last run
    GET /api/v1/browser-tests/{testId}/runs      # keyset-paginated runs (cursor, limit, status)
    GET /api/v1/runs/{runId}                     # run detail with attempts

Responses reuse the SPA presenters; monitors use the least-privileged MEMBER
view, so admin-only request configuration never leaks through a key. The
public surface is scoped to the key's workspace, rate limited per key
(120 requests/minute), and open to any CORS origin — the key itself is the
credential and no cookies are involved. Revoked keys and keys of deleted
workspaces are rejected with a uniform 401.

## Provider setup

### Paddle Billing

**Deferred during the free launch.** New workspaces receive an active internal
free subscription with the same product capabilities and limits as the planned
paid plan. Signup requires no checkout or payment card. See
[`docs/free-launch-plan.md`](../../docs/free-launch-plan.md) for the active
contract and future activation checklist.

When paid plans are resumed, use the Paddle sandbox until the entire checkout
and webhook smoke test passes.
The official catalog workflow is documented in
https://developer.paddle.com/build/products/create-products-prices/.

1. Create product **Zenguy** and a recurring monthly price of **EUR 39.00**.
   Copy its price ID to PADDLE_PRICE_ID.
2. Create product **Zenguy extra runs** and a one-time price of **EUR 0.20**.
   Copy its price ID to PADDLE_OVERAGE_PRICE_ID.
3. Create a sandbox client-side token for PADDLE_CLIENT_TOKEN and an API key
   for PADDLE_API_KEY. For overage billing, the API key must include
   `price.read`, `subscription.write`, and `transaction.read`. It also needs
   subscription read access and Customer portal session write access so owners
   receive fresh, short-lived payment and cancellation links; those links are
   never persisted from webhooks.
4. Under Developer tools > Notifications, create the sandbox destination at
   https://staging-app.zenguy.com/api/webhooks/paddle. Select exactly
   `subscription.created`, `subscription.updated`, `subscription.canceled`, and
   `subscription.past_due`. Copy that destination's secret to the staging
   PADDLE_WEBHOOK_SECRET. Paddle's destination guide is
   https://developer.paddle.com/webhooks/about/notification-destinations/.
5. Keep PADDLE_ENVIRONMENT=sandbox locally and in staging. Recreate the catalog,
   client token, API key, prices, and notification destination in Paddle Live
   for production. The production webhook URL is
   https://app.zenguy.com/api/webhooks/paddle. Sandbox and live IDs and secrets
   are not interchangeable.

The overage price is checked immediately before charging and must remain
exactly EUR 0.20 with no country-specific overrides. Overage settlement starts
only at `period_end + 1 hour`; until then it creates neither a report nor a
Paddle side effect. The pending period and report pin the subscription ID that
owned the period. A report is durably changed from `PENDING` to `AMBIGUOUS`
before its one allowed Paddle POST. Once `AMBIGUOUS`, every later run performs
marker reconciliation against that pinned subscription indefinitely and logs
an operator warning when unresolved; it never sends a second POST.

### Cloudflare Email Service

Zenguy sends transactional email through the Worker's native `EMAIL` binding;
there is no email-provider API key. The sending domain is `zenguy.com` in the
personal Cloudflare account.

1. Create and activate the directory-scoped personal profile if it is not
   already present:

       pnpm --filter @zenguy/api exec wrangler auth create zenguy-personal
       pnpm --filter @zenguy/api exec wrangler auth activate zenguy-personal
       pnpm --filter @zenguy/api exec wrangler whoami

   `whoami` must report the active profile `zenguy-personal` and
   `marcosaguayomora@gmail.com` before any Cloudflare mutation or deployment.

2. Confirm the domain is enabled:

       pnpm --filter @zenguy/api exec wrangler email sending settings zenguy.com --profile zenguy-personal

3. If it is not enabled, onboard it once:

       pnpm --filter @zenguy/api exec wrangler email sending enable zenguy.com --profile zenguy-personal

4. Keep `EMAIL_FROM="Zenguy <notifications@zenguy.com>"`. The
   `send_email` binding restricts the Worker to this sender.
5. The development binding has `remote: true`, so `wrangler dev` sends real
   email. Use only recipient inboxes you control. A deployed environment's
   binding omits `remote` because it already runs on Cloudflare.

Cloudflare manages the sending domain's SPF, DKIM, return-path, and bounce
records. Check Email Service analytics and suppressions when a provider accepts
a message but it does not reach the inbox.

### Twilio

Use the Twilio Console's Numbers and Senders setup:
https://www.twilio.com/docs/numbers-and-senders/add-numbers-and-senders.

1. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.
2. Provision an SMS-capable E.164 number for TWILIO_FROM_SMS.
3. Register and approve a WhatsApp sender for TWILIO_FROM_WHATSAPP.
4. Provision a voice-capable number for TWILIO_FROM_CALL.
5. Complete all regional registration, user opt-in, and template requirements
   before enabling production alerts.
6. SMS, call, and WhatsApp alerts are pay-as-you-go: they are charged from a
   prepaid per-workspace credit using the destination prices in
   `src/domain/alerts/pricing.ts`. Refresh that table whenever Twilio changes
   its rates; see `docs/alerts-paid-channels.md`.

### Mobile push (Expo)

The iOS app registers its Expo push token at `PUT /api/me/push-devices`; the
API then creates a free "Mobile push" channel in each of the user's
workspaces and sends through the Expo Push Service
(`https://exp.host/--/api/v2/push/send`). No APNs credentials live in the
Worker: EAS manages them for the app. Set `EXPO_PUSH_ACCESS_TOKEN` only if
"enhanced push security" is enabled for the Expo project. Details in
`docs/alerts-paid-channels.md` and
`docs/superpowers/specs/2026-08-22-push-notifications-design.md`.

### Local browser/model runner

The API has no OpenAI credential and no Browser Rendering binding. Configure a
Cloudflare Queue HTTP pull consumer, a dedicated `RUNNER_API_TOKEN`, the pinned
`browser-use` local worker, Google Chrome, and an OpenAI-compatible local model endpoint by following
`../../runner/README.md`. The configured model id is `qwen/qwen3.8-27b`; use the exact id
installed in Ollama, LM Studio, or the selected local server.

### Cloudflare plan

Treat Workers Paid as a release prerequisite for this project. It provides the
Queue and Worker capacity expected by the API, while five-minute browser
execution runs only on the external machine. Review current limits and pricing
before launch:

- https://developers.cloudflare.com/queues/platform/pricing/
- https://developers.cloudflare.com/workers/platform/limits/

## Staging and production deployment

Cloudflare Pages serves the React application on each application hostname.
The matching Worker environment is registered only as a zone route for
`/api/*`. This keeps frontend assets independent from API releases while
preserving relative API requests and same-origin cookies.

| Environment | Worker | Application / Pages origin | Worker Route | Billing | Status |
|---|---|---|---|---|---|
| Staging | `zenguy-api-staging` | `https://staging-app.zenguy.com` | `staging-app.zenguy.com/api/*` | Free; Paddle deferred | Operational |
| Production | `zenguy-api-production` | `https://app.zenguy.com` | `app.zenguy.com/api/*` | Free; Paddle deferred | Operational |

Production owns both `app.zenguy.com/api/*` and `api.zenguy.com`. Paddle is not a
production release gate during the free launch and its secret group remains
unset. Never substitute Sandbox values in production.

Do not configure either complete application hostname as a Worker custom
domain. Pages owns the hostname and static routes; the Worker Route owns only
the `/api/*` path.

### 1. Confirm the Cloudflare account

All mutations must use the directory-scoped personal profile:

    pnpm --filter @zenguy/api exec wrangler whoami

Continue only when it reports `zenguy-personal`,
`marcosaguayomora@gmail.com`, and account
`ec11e46fe3c39a5eac9951db9c91244a`.

### 2. Keep resources isolated

Each environment has its own stateful resources. The configured inventory is:

| Binding | Staging | Production |
|---|---|---|
| D1 `DB` | `zenguy-staging-db` | `zenguy-db` |
| KV `KV` | `zenguy-staging-kv` | `zenguy-kv` |
| R2 `ARTIFACTS` | `zenguy-staging-artifacts` | `zenguy-artifacts` |
| `RUN_QUEUE` | `zenguy-staging-runs` | `zenguy-runs` |
| Run DLQ | `zenguy-staging-runs-dlq` | `zenguy-runs-dlq` |
| `CHECK_QUEUE` | `zenguy-staging-checks` | `zenguy-checks` |
| Check DLQ | `zenguy-staging-checks-dlq` | `zenguy-checks-dlq` |
| `NOTIFY_QUEUE` | `zenguy-staging-notify` | `zenguy-notify` |
| Notification DLQ | `zenguy-staging-notify-dlq` | `zenguy-notify-dlq` |

The D1 and KV IDs in `apps/api/wrangler.jsonc` must match the resources in this
account. Wrangler environment bindings are not inherited, so every binding is
declared independently under `env.staging` and `env.production`. Never reuse a
production ID in staging or a staging ID in production.

### 3. Configure secrets and provider environments

Wrangler secrets are also environment-specific. Put each Appendix A secret in
both environments, using independent cryptographic values and the appropriate
provider credentials:

    pnpm --filter @zenguy/api exec wrangler secret put <NAME> --env staging
    pnpm --filter @zenguy/api exec wrangler secret put <NAME> --env production

Repeat those commands for `JWT_SECRET`, `ENCRYPTION_KEY`,
`ARTIFACT_URL_SECRET`, `RUNNER_API_TOKEN`, all five `TWILIO_*` values, all
five `PADDLE_*` values, and — once alert-credit top-ups should open — the
optional `PADDLE_ALERT_CREDIT_PRICE_ID` (see `docs/alerts-paid-channels.md`). Do not paste secret values into shell history,
documentation, `wrangler.jsonc`, or Git.

Environment variables are fixed as follows:

| Variable | Staging | Production |
|---|---|---|
| `ENVIRONMENT` | `staging` | `production` |
| `APP_URL` | `https://staging-app.zenguy.com` | `https://app.zenguy.com` |
| `PADDLE_ENVIRONMENT` | `sandbox` | `production` |
| `LLM_MODEL` | `qwen/qwen3.8-27b` | `qwen/qwen3.8-27b` |
| `EMAIL_FROM` | `Zenguy <notifications@zenguy.com>` | `Zenguy <notifications@zenguy.com>` |

Staging uses only Paddle Sandbox tokens, keys, price IDs, customers, and its
verified staging webhook secret. Production must use only Paddle Live
equivalents and its own production webhook secret once activated. Browser
inference is performed by the separately configured local runner. Deployed
environments use the native Cloudflare Email Service `EMAIL` binding for the
enabled `zenguy.com` sending domain.

### 4. Migrate and deploy the selected environment

Apply migrations before its Worker deployment:

    # Staging
    pnpm --filter @zenguy/api db:migrate:staging
    pnpm --filter @zenguy/api deploy:staging

    # Safe production bootstrap; does not add routes, cron, or consumers
    pnpm --filter @zenguy/api deploy:production:bootstrap

    # Final activation; only after every Live-provider gate is satisfied
    pnpm --filter @zenguy/api db:migrate:production
    pnpm --filter @zenguy/api deploy:production

The normal production deploy is intentionally different from the bootstrap:
it activates the `/api/*` route, three cron triggers, and the check,
notification, and DLQ Worker consumers. The run queue must separately have its
HTTP pull consumer enabled as documented in `../../runner/README.md`. Do not use
production as a harmless first upload.

A push to the `staging` branch runs `.github/workflows/staging.yml`: it
migrates `zenguy-staging-db`, deploys `zenguy-api-staging`, then wipes and
reseeds application data through `scripts/reseed-staging.mjs`. That wrapper
hardcodes `--remote --env staging --allow-remote --confirm-staging` and cannot
target `zenguy-db` or production. Keep production CI disabled until every
production release gate listed above is complete.

The API deployment does not build or upload `apps/frontend/dist`; Pages builds
that package independently from Git. The frontend projects and branch controls
are documented in `apps/frontend/README.md`.

Each deploy registers these Cron Triggers for that environment:

- Every five minutes: scheduled browser tests and uptime monitors.
- Daily at 03:00 UTC: retention cleanup.
- At minute 30 of every hour: stale work and billing maintenance.

Under Workers & Pages, verify the three triggers, five Worker consumers (check,
notify, and the three DLQs), and one HTTP pull consumer on the run queue in each
active environment. The run queue must not list the API Worker as its consumer.

### 5. Verify Pages domains and Worker Routes

The Pages custom domain must be active and proxied before its API route is
useful. Staging currently uses the first assignment; production must use the
second assignment only when its Worker is activated:

    staging-app.zenguy.com/api/*  -> zenguy-api-staging
    app.zenguy.com/api/*          -> zenguy-api-production

Requests outside `/api/*` must continue to reach the corresponding Pages
project. A missing route commonly appears as a Pages 404 for API calls; a route
covering `/*` would incorrectly hide the frontend.

### 6. Configure webhook destinations and R2 retention

Create separate Paddle notification destinations:

    Sandbox (active):    https://staging-app.zenguy.com/api/webhooks/paddle
    Live (release gate): https://app.zenguy.com/api/webhooks/paddle

Subscribe each destination to exactly `subscription.created`,
`subscription.updated`, `subscription.canceled`, and `subscription.past_due`.
Do not subscribe transaction events. Store each destination's signing secret
only in its matching Worker environment.

The cleanup cron expires operational data after 30 days. Add a 35-day R2
lifecycle safety net to each bucket:

    pnpm --filter @zenguy/api exec wrangler r2 bucket lifecycle add zenguy-staging-artifacts retention-safety-net --expire-days 35
    pnpm --filter @zenguy/api exec wrangler r2 bucket lifecycle add zenguy-artifacts retention-safety-net --expire-days 35

## Post-deploy smoke

Run the full functional smoke in staging first and stop the release on the
first failure:

1. Call `https://staging-app.zenguy.com/api/health`; expect HTTP 200 and a JSON
   data envelope with `ok=true`. Load the hostname without `/api` and confirm
   Pages returns the React application.
2. Register an address you control, receive the real Cloudflare Email Service
   verification email from `notifications@zenguy.com`, verify it, and log in.
   Confirm refresh and secure cookies stay on `staging-app.zenguy.com`.
3. Create a workspace and confirm it is immediately `ACTIVE` with source
   `free`, reaches Overview without checkout, and asks for no payment card.
4. Start the local Python runner and its local model, create an `example.com`
   Browser Test, and run **Test it**. Confirm the run is pulled on the local
   machine, reaches `PASSED`, its attempt and screenshots load, and usage
   increases by exactly one.
5. Create a GET monitor for `https://example.com` expecting 200. Confirm it
   becomes `UP` within five minutes without changing browser-run usage.
6. Trigger one safe failure and recovery. Confirm one failure delivery and one
   recovery delivery are recorded, then verify no plaintext secret appears in
   the API response, report, logs, or notification error.

Deploy production and repeat the non-destructive checks against
`https://app.zenguy.com`. Confirm `/api/health` is handled by
`zenguy-api-production`, the application shell is served by Pages, email uses
`zenguy.com`, and billing config reports `mode: "free"`. Paddle Live activation
is a separate future release and any real checkout requires explicit approval.

## First-demo acceptance record

The PROJECT.md section 33 flow was executed on 2026-08-19, before the external
runner migration in this change. That historical walkthrough used an isolated
local D1/R2/Queue state with a remote Cloudflare Browser binding and OpenAI. It
is retained only as an acceptance record; the active architecture is the Queue
HTTP pull + local Python worker documented above. No production customer data
was used.

| Step | Expected demonstration | Recorded evidence |
|---:|---|---|
| 1 | Create workspace | PASS — ws_01m0cfg59krrav6caax9hdr0zk |
| 2 | Pay or activate development subscription | PASS — isolated workspace subscription set ACTIVE |
| 3 | Create secret | PASS — sec_01m0cfg63g4m15gvw7t21rvvsw |
| 4 | Create Browser Test | PASS — bt_01m0cfg63z1ayzrqvb5fh6nzr7 |
| 5 | Press Test it | PASS — validation run run_01m0cfg64881204m0m4gjyw2ym |
| 6 | Watch browser execute | PASS — remote Browser session completed through the Queue consumer |
| 7 | Get result, attempts, and screenshots | PASS — validation run PASSED with one attempt and two R2 screenshots |
| 8 | Force failure | PASS — run_01m0cfgnyhnc8gpye7kwtrafhw finished FAILED after two attempts |
| 9 | Get Markdown report | PASS — final report stored and downloaded, 2,928 bytes |
| 10 | Receive alert | PASS — browser incident inc_01m0cfhavvwbe7q7xdeny7pvrq; delivery del_01m0cfhavx8f7f7187zqrk2b86 reached SENT through the injected acceptance-test sender |
| 11 | Create Uptime Monitor | PASS — mon_01m0cfnfbvwt8nr2wagwgk94wt |
| 12 | Cause incident | PASS — uptime incident inc_01m0cfnjb602c77e5n4nbvdytr; failure delivery del_01m0cfnjb95bw5cs3p62c8fhed |
| 13 | Receive recovery | PASS — the same incident resolved; recovery delivery del_01m0cfnny9gb13k4r10qpvge1w reached SENT |
| 14 | Retry consumes only one Browser Test run | PASS — usage was 2 total: one validation run plus exactly one unit for the two-attempt failed run |

The injected acceptance-test sender proves dispatch, persistence, retry, and
delivery-state behavior without contacting a real inbox. The Cloudflare Email
Service smoke above is the external delivery check.

### Deployed staging smoke record

The following checks were executed against the deployed staging origin. They
use the isolated staging D1, R2, and Queue resources; they are separate from
the local/remote first-demo walkthrough above.

| Check | Recorded evidence |
|---|---|
| Worker health | PASS — `https://staging-app.zenguy.com/api/health` returned HTTP 200 with `data.ok=true` from Worker version `2ed3d79d-e510-4ad0-9cad-0d34b5688236` |
| Browser validation | PASS — run `run_01m0dnyvtaepvdk2ztea1hyphq`, attempt `att_01m0dnyvta025kaz0xfe1226ge`, status `PASSED`, two steps and two screenshot artifacts |
| Browser-run billing | PASS — cycle usage changed to one billable run (299 of 300 included runs remaining) |
| Uptime scheduling | PASS — monitor `mon_01m0dp0x7csks3ypafm0wzkm6y` was claimed by the deployed `*/5` cron and became `UP` |
| Uptime evidence | PASS — check `chk_01m0dpbz3ey0rtvh09w3bphfx1` finished `PASSED` in 9 ms; history and 24-hour stats each exposed the result |
| Uptime billing isolation | PASS — browser-run usage stayed at one after the uptime check |
| External-runner queue topology (2026-08-20) | PASS — `zenguy-staging-runs` has one HTTP pull consumer (15-minute visibility, batch size 1) and no Worker consumer |
| Local Bionic/Chrome execution (2026-08-20) | PASS — run `run_01m0ftedz912vye0w75yrtqf0j` was enqueued by staging, claimed over HTTP, executed in local Chrome with `qwen/qwen3.8-27b`, persisted as `PASSED`, and acknowledged only after completion |
| External-runner evidence (2026-08-20) | PASS — attempt `att_01m0ftedz9hj02vmwtzxa1rrwv` recorded runner `zenguy-local-runner/1.0.0`, model `qwen/qwen3.8-27b`, and 2,734 tokens; the disposable smoke test was removed afterwards |
| Current browser-use runtime smoke (2026-08-20) | PASS — `browser-use 0.13.8` used the current `JobExecutor`, visible Chrome and local `qwen/qwen3.8-27b` to verify `example.com`; structured `done` returned `PASSED` in two steps with one screenshot and 9,886 tokens. This local-only smoke made no Queue/API writes |

The release acceptance is intentionally still open: a real Cloudflare Email
Service recipient, the corrected Paddle Sandbox notification destination and
checkout, and an external failure/recovery delivery have not yet been approved
or exercised. Production remains isolated until its Paddle Live and Twilio
credentials are configured and those staging checks pass.

## V1 acceptance sign-off

Each PROJECT.md section 31 criterion has automated evidence or an explicit
manual release check. Paths are relative to apps/api/src unless noted.

### 31.1 Workspace and permissions

| ID | Criterion | How verified |
|---|---|---|
| 31.1.1 | A user can register | Automated: http/routes/auth_routes.itest.ts and application/auth/register.test.ts |
| 31.1.2 | A user can create a workspace | Automated: http/routes/workspace_routes.itest.ts |
| 31.1.3 | Members can be invited | Automated: http/routes/invitation_routes.itest.ts |
| 31.1.4 | Owner can invite Admins | Automated: http/routes/invitation_routes.itest.ts |
| 31.1.5 | Admin cannot create another Admin | Automated: http/routes/invitation_routes.itest.ts and domain/workspaces/permissions.test.ts |
| 31.1.6 | Member cannot modify tests | Automated: http/routes/browser_test_routes.itest.ts |
| 31.1.7 | Backend rejects unauthorized operations | Automated: http/routes/rbac_matrix.itest.ts covers every Appendix C route for owner, admin, member, outsider, and unauthenticated callers |
| 31.1.8 | User can switch workspaces | Automated: http/routes/workspace_routes.itest.ts lists all memberships; manual UI check selects each returned workspace |
| 31.1.9 | No cross-workspace data leak | Automated: http/routes/cross_tenant.itest.ts checks run, attempt, artifact, monitor, incident, and secret identifiers |

### 31.2 Browser Tests

| ID | Criterion | How verified |
|---|---|---|
| 31.2.1 | Create a natural-language test | Automated: http/routes/browser_test_routes.itest.ts accepts instructions as the primary input |
| 31.2.2 | Choose Desktop or Mobile | Automated: domain/browser_tests/rules.test.ts and http/routes/browser_test_routes.itest.ts |
| 31.2.3 | Desktop is 1440×900 | Automated: domain/browser_tests/rules.test.ts snapshot assertion |
| 31.2.4 | Mobile is 390×844 | Automated: domain/browser_tests/rules.test.ts snapshot assertion |
| 31.2.5 | Interval is selectable from 1–24 hours | Automated: domain/browser_tests/rules.test.ts |
| 31.2.6 | Configure 0–3 retries | Automated: domain/browser_tests/rules.test.ts |
| 31.2.7 | Save even when Test it fails | Automated contract: browser creation in http/routes/browser_test_routes.itest.ts is independent from validation-run status; first-demo failed run left the test saved |
| 31.2.8 | Test it consumes one run | Automated: http/routes/browser_test_run_routes.itest.ts and application/billing/run_usage.test.ts; first-demo validation usage |
| 31.2.9 | Run now consumes one run | Automated: http/routes/browser_test_run_routes.itest.ts and application/execution/attempt_lifecycle.test.ts |
| 31.2.10 | Scheduled execution consumes one run | Automated: application/maintenance/sweeps.test.ts and application/execution/attempt_lifecycle.test.ts |
| 31.2.11 | Retries do not consume runs | Automated: application/execution/attempt_lifecycle.test.ts records usage once; first-demo two-attempt run added one unit |
| 31.2.12 | Every attempt starts clean | Automated: infrastructure/browser/session.test.ts and application/execution/execute_attempt.test.ts create and dispose an isolated browser session per attempt |
| 31.2.13 | Agent can navigate to other domains | Automated: application/execution/run_agent.test.ts and application/execution/execute_attempt.test.ts allow safe external navigation while revalidating targets |
| 31.2.14 | Five-minute timeout becomes TIMEOUT | Automated: application/execution/execute_attempt.test.ts hard-disposes a hung agent at ATTEMPT_TIMEOUT_MS |
| 31.2.15 | TIMEOUT differs from FAILED | Automated: domain/browser_tests/run_rules.test.ts and application/reports/generate_report.test.ts |
| 31.2.16 | Infrastructure error becomes SYSTEM_ERROR | Automated: application/execution/execute_attempt.test.ts and application/execution/attempt_lifecycle.test.ts |
| 31.2.17 | Passing during retry finishes PASSED | Automated: domain/browser_tests/run_rules.test.ts and application/execution/attempt_lifecycle.test.ts |
| 31.2.18 | Passed after retry is exposed | Automated: application/execution/attempt_lifecycle.test.ts and http/routes/run_read_routes.itest.ts |
| 31.2.19 | Failed run keeps evidence | Automated: application/execution/execute_attempt.test.ts and http/routes/run_read_routes.itest.ts; first-demo report and screenshots |
| 31.2.20 | Initial 100 results plus pagination | Automated: application/browser_tests/list_runs.ts defaults to 100 and http/routes/run_read_routes.itest.ts proves keyset pagination |
| 31.2.21 | Results expire after 30 days | Automated: application/execution/execute_attempt.test.ts, application/reports/generate_report.test.ts, and application/maintenance/purge_expired.itest.ts |

### 31.3 Reports

| ID | Criterion | How verified |
|---|---|---|
| 31.3.1 | Final failure generates Markdown | Automated: application/reports/generate_report.test.ts and generate_report.itest.ts; first-demo 2,928-byte report |
| 31.3.2 | Report can be downloaded | Automated: http/routes/run_read_routes.itest.ts |
| 31.3.3 | Includes instructions, expected, actual, steps, and artifacts | Automated snapshot: application/reports/generate_report.test.ts |
| 31.3.4 | Contains no secrets | Automated: application/reports/generate_report.test.ts and http/routes/secret_leak.itest.ts |
| 31.3.5 | Does not invent root cause | Automated snapshot: application/reports/generate_report.test.ts emits observed facts and the explicit no-unverified-root-cause note |

### 31.4 Uptime

| ID | Criterion | How verified |
|---|---|---|
| 31.4.1 | Create a GET monitor | Automated: http/routes/uptime_routes.itest.ts |
| 31.4.2 | Create POST with headers and body | Automated: http/routes/uptime_routes.itest.ts proves encrypted configuration and masking |
| 31.4.3 | Check status | Automated: application/uptime/execute_check.test.ts |
| 31.4.4 | Check body | Automated: application/uptime/execute_check.test.ts |
| 31.4.5 | Check JSON path | Automated: application/uptime/execute_check.test.ts and shared/jsonpath.test.ts |
| 31.4.6 | Select defined frequencies | Automated: domain/uptime/rules.test.ts |
| 31.4.7 | Uptime checks do not consume runs | Automated architecture: application/uptime/handle_check_message.test.ts completes cycles without RunUsage; first-demo monitor left usage unchanged |
| 31.4.8 | Uptime retries do not consume runs | Automated: application/uptime/handle_check_message.test.ts retry ladder has no billing dependency |
| 31.4.9 | Incident opens and closes | Automated: application/uptime/handle_check_message.test.ts; first-demo incident inc_01m0cfnjb602c77e5n4nbvdytr opened and resolved |
| 31.4.10 | Show 24h, 7d, and 30d stats | Automated: application/uptime/get_monitor_stats.test.ts and http/routes/uptime_routes.itest.ts |
| 31.4.11 | No public status page in V1 | Route-inventory review: http/routes/rbac_matrix.itest.ts covers the complete public API and exposes no status-page endpoint; manual production route check |

### 31.5 Notifications

| ID | Criterion | How verified |
|---|---|---|
| 31.5.1 | Create email channel | Automated: http/routes/channel_routes.itest.ts and domain/channels/types.test.ts |
| 31.5.2 | Create Slack and Discord channels | Automated: http/routes/channel_routes.itest.ts and infrastructure/notify/webhooks.test.ts |
| 31.5.3 | Configure Twilio SMS, WhatsApp, and call | Automated: domain/channels/types.test.ts, infrastructure/notify/twilio.test.ts, and infrastructure/notify/index.test.ts |
| 31.5.4 | Test can use multiple channels | Automated: application/channels/dispatch_notifications.test.ts and http/routes/browser_test_routes.itest.ts |
| 31.5.5 | Alert once after retries | Automated: application/incidents/handle_run_finalized.test.ts and application/uptime/handle_check_message.test.ts |
| 31.5.6 | Recovery alert when enabled | Automated: application/incidents/handle_run_finalized.test.ts and application/uptime/handle_check_message.test.ts; first-demo recovery delivery |
| 31.5.7 | Failed channel does not block others | Automated: application/channels/send_queued_notification.test.ts isolates outcomes in one batch |
| 31.5.8 | Deliveries are logged | Automated: http/routes/channel_routes.itest.ts and application/channels/send_queued_notification.test.ts; first-demo delivery IDs recorded above |

### 31.6 Secrets

| ID | Criterion | How verified |
|---|---|---|
| 31.6.1 | Create a key | Automated: http/routes/secret_routes.itest.ts |
| 31.6.2 | Value is encrypted | Automated: http/routes/secret_routes.itest.ts, infrastructure/db/secret_repo.itest.ts, and shared/crypto.test.ts |
| 31.6.3 | Value is never displayed again | Automated: http/routes/secret_routes.itest.ts and http/routes/secret_leak.itest.ts |
| 31.6.4 | Use {{KEY}} placeholders | Automated: application/secrets/resolve_secrets.test.ts and application/execution/execute_attempt.test.ts |
| 31.6.5 | Respect allowed domains | Automated: application/secrets/resolve_secrets.test.ts and application/uptime/execute_check.test.ts |
| 31.6.6 | Reports and redacted logs omit values | Automated: application/reports/generate_report.test.ts, http/run_stream.test.ts, http/routes/secret_leak.itest.ts, application/channels/send_queued_notification.test.ts, and the inline-delivery case in http/routes/channel_routes.itest.ts |
| 31.6.7 | Show staging-credentials warning | Manual frontend release check: TASKS_FRONTEND.md requires the exact warning on both the Secrets page and Browser Test form |

### 31.7 Billing

| ID | Criterion | How verified |
|---|---|---|
| 31.7.1 | Every workspace has a subscription | Automated: http/routes/workspace_routes.itest.ts and infrastructure/db/billing_repos.itest.ts |
| 31.7.2 | Includes 300 runs | Automated: application/billing/get_billing.test.ts and http/routes/billing_routes.itest.ts |
| 31.7.3 | Run 301 adds EUR 0.20 | Automated: application/billing/get_billing.test.ts and application/billing/report_overage_for_period.test.ts |
| 31.7.4 | Retries do not increment usage | Automated: application/execution/attempt_lifecycle.test.ts and first-demo usage comparison |
| 31.7.5 | Uptime does not increment usage | Automated architecture: application/uptime/handle_check_message.test.ts; first-demo usage comparison |
| 31.7.6 | FAILED and TIMEOUT increment usage | Automated: application/execution/attempt_lifecycle.test.ts and domain/browser_tests/run_rules.test.ts |
| 31.7.7 | Zenguy SYSTEM_ERROR does not increment usage | Automated: application/execution/attempt_lifecycle.test.ts and application/maintenance/hourly.test.ts reverse unused usage |
| 31.7.8 | Webhooks are idempotent | Automated: application/billing/handle_paddle_webhook.test.ts and http/routes/webhooks.test.ts |
| 31.7.9 | Owner sees estimated cost | Automated: application/billing/get_billing.test.ts and http/routes/billing_routes.itest.ts enforce owner-only billing detail |

### 31.8 Security

| ID | Criterion | How verified |
|---|---|---|
| 31.8.1 | Block SSRF to private networks | Automated: shared/ssrf.test.ts and application/execution/execute_attempt.test.ts |
| 31.8.2 | Validate redirects | Automated: application/uptime/execute_check.test.ts and infrastructure/browser/session.test.ts |
| 31.8.3 | Do not expose secrets | Automated defense sweep: http/routes/secret_leak.itest.ts plus shared/redact.test.ts |
| 31.8.4 | Artifacts require authorization | Automated: http/routes/run_read_routes.itest.ts and http/artifact_sign.test.ts validate short-lived signatures and hide invalid ones |
| 31.8.5 | Rate limiting exists | Automated: shared/ratelimit.test.ts plus auth, run, channel, invitation, monitor, and report route tests |
| 31.8.6 | Audit log exists | Automated: application/audit/audit_wiring.test.ts, http/routes/audit_routes.itest.ts, and all mutating route suites |
| 31.8.7 | Browser is destroyed after each attempt | Automated: infrastructure/browser/session.test.ts and application/execution/execute_attempt.test.ts cover success, failure, timeout, and launch errors |

## Verification

Run the complete release gate from the repository root:

    pnpm typecheck
    pnpm test
    pnpm --filter @zenguy/api test:integration

Latest local automated verification on 2026-08-19:

- Root typecheck: PASS.
- Unit suite: PASS — 81 files, 543 tests.
- Integration suite: PASS — 36 files, 185 tests.

## Minimum iOS app version (forced updates)

`GET /api/app/version` is public and returns
`{ "data": { "minVersion": "<semver>", "storeUrl": "<https://apps.apple.com/…>" | null } }`
(cached for five minutes). The iOS app (`apps/app`) reads it on launch and when it
returns to the foreground; a build older than `minVersion` shows a blocking
"Update required" screen with an "Open the App Store" button.

- To force every user onto a newer build, bump `MIN_APP_VERSION` in
  `src/shared/constants.ts` and deploy the API.
- `IOS_APP_STORE_URL` (optional var per environment) must be an
  `https://apps.apple.com/…` link; set it once the app is published. Any other
  value fails configuration loading on purpose.
