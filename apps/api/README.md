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

Local API credentials live in a dedicated macOS login-Keychain service. The
default development and seed commands do not read `.dev.vars`, do not inherit
the shell's environment into the Worker, and do not create a temporary secrets
file with persisted bytes. Install dependencies and inspect the credential
inventory:

    pnpm install
    pnpm --filter @zenguy/api secrets:list
    pnpm --filter @zenguy/api secrets:status
    pnpm --filter @zenguy/api secrets:audit-local

Add one value at a time. `/usr/bin/security` prompts for the value because the
loader deliberately never puts it in argv, stdout, shell history, or an
environment variable:

    pnpm --filter @zenguy/api secrets:set -- JWT_SECRET

Repeat for the required names printed by `secrets:list`, then validate the
whole group without printing values:

    pnpm --filter @zenguy/api secrets:verify

For a fresh setup, obtain the local Google Web OAuth client ID/secret and
generate seven independent values in a password manager: JWT_SECRET,
GOOGLE_OAUTH_STATE_SECRET, ENCRYPTION_KEY (canonical base64 for exactly 32
bytes), ARTIFACT_URL_SECRET, RUNNER_API_TOKEN, RUNNER_FALLBACK_API_TOKEN and
RUNNER_CAPABILITY_SECRET. The six non-encryption generated values need at least
32 characters; Google's provider-issued client secret only needs to be
non-empty. Use a unique `ENCRYPTION_KEY_ID`, local-only Twilio credentials and
senders, and never reuse any value in staging or production. Stripe's five core
items are optional but all-or-none; the alert-credit product/price IDs are also
a pair.

If an ignored `.dev.vars` already exists, migrate each value through the same
interactive `secrets:set` command. Do not automate that copy through command
arguments. Keep the legacy file untouched until `secrets:verify`, the seed and
an API decrypt smoke all pass against every retained local D1 state. Archiving
or deleting it, retiring `ENCRYPTION_PREVIOUS_KEYS`, and rotating provider
credentials are separate, explicitly approved operations.

`secrets:audit-local` checks only `lstat` metadata for the fixed inventory of
ignored local credential files. Every present entry must be a regular,
non-symlink file owned by the current user with exact mode `0600`; dangling
symlinks, directories, foreign owners and broader modes fail closed. The audit
never opens a file or prints a value, and reports the legacy `.dev.vars` as a
pending manual migration instead of deleting or rotating it.

Treat every key ever published in an example as compromised. A copy may remain
temporarily in `ENCRYPTION_PREVIOUS_KEYS` only to decrypt and rewrite retained
local data; it is not a safe write key. Do not retire that dual-read entry until
all retained D1 states and approved backups pass the documented rotation and
decrypt smoke.

`secrets:set` refuses to overwrite an existing item. `--replace` is available
only for an intentional, coordinated rotation. `.dev.vars.example` is an
assignment-free pointer to this workflow, and direct remote/named-environment
development is blocked so local credentials cannot be mixed with deployed
resources. The wrapper accepts only an optional `--port` argument for
`wrangler dev`; its API and inspector binds are fixed to `127.0.0.1`, and
caller-selected tunnels, IPs, inspector ports, configs, state roots, env files,
and entrypoints fail closed. The loader also gives its child processes an
explicit environment allowlist, so `CLOUDFLARE_INCLUDE_PROCESS_ENV`,
`NODE_OPTIONS`, provider tokens, and unrelated shell secrets cannot silently
become Worker bindings.

At runtime the seed receives its two encryption bindings over anonymous
descriptor `/dev/fd/3`. Wrangler must read its env file more than once, so the
development command instead creates a mode-0600 FIFO inside a fresh mode-0700
temporary directory. A supervised helper retains the payload only in memory
and serves one exact copy per FIFO open; the FIFO inode contains no persisted
bytes. The wrapper zeroes mutable transport buffers and removes only its own
validated temporary directory when Wrangler exits.

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
- Complimentary active subscription with no billing-provider customer
- Browser tests, completed runs, and uptime monitors ("beats")
- DEMO_TOKEN secret restricted to example.com

Preview the SQL without executing it:

    pnpm --filter @zenguy/api seed -- --dry-run

Remote seeding is intentionally disabled. The deterministic accounts,
passwords, API keys and fixtures above are local-only; staging data must be
provisioned with one-time random credentials through the normal product flows
and a secret manager.

## Password hashing and new-password policy

New password records use the explicit
`pbkdf2-sha256$v1$<iterations>$<salt>$<digest>` format, NFC-normalized UTF-8,
a random 16-byte salt, a 32-byte digest, and 600,000 PBKDF2-HMAC-SHA256
iterations. Cloudflare Workers Web Crypto supports PBKDF2 but not Argon2id, so
this is the supported-runtime baseline from the
[OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
The verifier bounds encoded cost and field sizes before deriving. Historical
`pbkdf2$<iterations>$...` records remain readable and are compare-and-swap
rehashed after a successful login; a concurrent password reset/change always
wins rather than being overwritten by that migration.

Before changing the work factor or releasing on materially different
hardware, run the reproducible local calibration under the repository-pinned
Node version:

    pnpm --filter @zenguy/api benchmark:password-kdf -- --samples=7

It exits non-zero when p95 exceeds the one-second ceiling. This local result is
not a substitute for checking authentication latency and Worker CPU in staging;
record both with the release evidence before raising the factor.

New registrations and password resets require 15–100 Unicode code points and
apply the same authoritative server policy. The offline blocklist vendors the
NCSC 100k most-used-password corpus through SecLists commit
`1a7bb9127eca9e6ff2fc0301c597fe6e16a0cb56`, filters it to values that can pass
the historical 12-character minimum, normalizes it with NFKC/lowercase, and
adds Zenguy-specific/common variants. The source and generated-subset SHA-256
values are pinned beside the corpus. This avoids sending even a k-anonymous
password hash prefix to a third party during account creation. Review and
refresh the pinned corpus deliberately; never follow a mutable branch in a
release build.

Registration and login do not disclose whether an email already exists:
duplicate registration performs the same current KDF work, returns the same
token-free `{ registrationPending: true, email }` result, and sends a safe
notice only to the existing mailbox. Registration signs no JWT, persists no
refresh token, and sets no cookie for either branch;
unknown-account login verifies a fixed current-format dummy hash. Email
activation requires both the live inbox token and the exact password chosen in
that registration. The server checks a cheap token lookup before PBKDF2, does
not consume the token on a wrong password, and atomically claims it only after
both factors pass. Verification attempts are bounded independently by source
IP and by a digest of the token. Password/auth-version checks around session
insertion ensure a concurrent password reset wins and revokes any just-created
refresh token. This prevents a mailbox owner from
accidentally activating an attacker-selected password after an unsolicited
registration while preserving existing pending accounts and legacy hashes.

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

Strict application rate limits use `rate_limit_windows`, created by migration
`0027_atomic_limits.sql`; Workers KV is not an admission counter. A single D1
statement conditionally consumes every workspace/actor/IP/destination scope
for a rule, so concurrent isolates admit at most the configured limit and a
blocked request does not partially charge sibling scopes. The remaining KV use
in billing-webhook handling is only a best-effort replay cache layered over D1
idempotency constraints. The versioned Cloudflare edge rate-limit policy in
`security/cloudflare-edge-policy.json` remains a separate pre-limit and must be
deployed and verified remotely before public production traffic.

## Browser-run allowances, safety ceilings, and test export

The 300 included browser-test runs belong to each workspace independently.
They are usage/billing allowance, not an owner-wide hard stop: paid run 301 is
overage, and run 301 stays available without a usage charge during the free
launch. Migration `0043_workspace_run_allowance_scope.sql` removes the old
complimentary-account trigger that incorrectly pooled 300 runs across an
owner's workspaces. The atomic D1 controls from migration 0036 remain separate:
active, UTC-day, and UTC-month ceilings are reserved for workspace, triggering
user, owner, and global scopes. Those operational circuit breakers limit abuse
and platform cost without changing how any workspace's 300 included runs are
calculated.

The normal browser-test list remains keyset-paginated at 1–100 items per
request. A workspace can contain at most 200 live tests. Export walks that same
ordering internally in at most two 100-item pages (plus one bounded sentinel
row), batches channel lookups, and emits all 200 permitted tests. A 201st legacy
row fails closed instead of silently truncating the file. Transfer files remain
limited to 200 entries and imports retain the 2 MB request/body ceiling.

## Provider setup

### Google OAuth

Zenguy uses a server-side OAuth authorization-code flow. The Google client
secret and the state-signing secret never enter the Vite bundle; all three
Google bindings belong to the API Worker. Create distinct Web application
clients for local development, staging, and production under the reviewed
Google Auth Platform project, and register only the callback URI used by each
environment:

| Environment | Authorized redirect URI |
|---|---|
| Local | `http://localhost:5173/api/auth/google/callback` |
| Staging | `https://staging-app.zenguy.com/api/auth/google/callback` |
| Production | `https://app.zenguy.com/api/auth/google/callback` |

Do not use `api.zenguy.com` or `api-staging.zenguy.com` as browser callbacks.
Authentication deliberately returns through the Pages application origin so
the host-only refresh cookie remains on the same origin used by subsequent
`/api/auth/*` requests. Authorized JavaScript origins are not required for this
server-side flow.

Store `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and
`GOOGLE_OAUTH_STATE_SECRET` in the local Keychain workflow and in each matching
named Worker environment. The client ID and provider-issued client secret must
be non-empty. The state secret must contain at least 32 characters and must not
reuse JWT, encryption, artifact, runner, or Google client-secret material.
Never commit any of these values or expose them through a `VITE_*` variable.

Google sign-in deliberately does not create a Zenguy account or bypass the
existing terms/privacy acceptance flow. On the first use it may link only an
existing verified account when Google is authoritative for the address: a
Gmail address or an account carrying Google's signed Workspace `hd` claim.
Other third-party Google identities must continue with the Zenguy email and
password flow; a mutable email alone is never treated as a durable identity.

### Stripe Billing

Use Stripe test mode until the complete Checkout, webhook, portal, invoice,
refund and dispute smoke test passes. Stripe-hosted Checkout collects billing
addresses, tax IDs and automatic tax; no publishable or secret Stripe key is
sent to the browser.

1. Create product **Zenguy** and a recurring monthly EUR 39.00 price. Use
   inclusive tax behavior so the advertised amount, credit/refund accounting,
   and Stripe total remain aligned. Set its IDs as `STRIPE_PRODUCT_ID` and
   `STRIPE_PRICE_ID`.
2. Create product **Zenguy extra runs** and a one-time EUR 0.20 price with the
   same inclusive tax behavior. Set its price ID as `STRIPE_OVERAGE_PRICE_ID`.
3. Create product **Zenguy alert credit pack** and a one-time EUR 10.00 price
   with inclusive tax behavior.
   Set `STRIPE_ALERT_CREDIT_PRODUCT_ID` and
   `STRIPE_ALERT_CREDIT_PRICE_ID`; the pair is required together.
4. Create a restricted server key with the minimum Checkout Session, Billing
   Portal, subscription, invoice, invoice-item, price, PaymentIntent and refund
   permissions required by these flows. Store it only as
   `STRIPE_SECRET_KEY`; there is no client-side token.
5. Create test and live webhook destinations at
   `https://staging-app.zenguy.com/api/webhooks/stripe` and
   `https://app.zenguy.com/api/webhooks/stripe`. Subscribe to
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `customer.subscription.paused`,
   `customer.subscription.resumed`, `refund.created`, `refund.updated`,
   `charge.dispute.created`, and `charge.dispute.closed`. Store each `whsec_…`
   value only in its matching `STRIPE_WEBHOOK_SECRET`.
6. Keep `STRIPE_ENVIRONMENT=test` locally and in staging and use
   `STRIPE_ENVIRONMENT=live` only with live keys, prices and webhook secret in
   production. `loadConfig` rejects a key whose prefix does not match the
   selected environment and rejects simultaneous Paddle and Stripe groups.

The webhook consumes a durable, one-use checkout intent before binding a
subscription or crediting a top-up. A top-up is idempotent on its PaymentIntent;
succeeded refunds debit only that transaction, and disputes debit once and
restore funds only when won. The periodic reconciliation lists succeeded
refunds with the same ledger idempotency keys as the webhook path.

The overage price is re-read immediately before charging and must remain a
one-time EUR 0.20 price. Settlement starts only at `period_end + 1 hour` and
pins the subscription that owned that period. Stripe receives the deterministic
overage marker as the idempotency key for invoice creation, invoice-item
creation and finalization; retries reconcile the same invoice instead of
creating a second charge.

### Cloudflare Email Service

Zenguy sends transactional email through the Worker's native `EMAIL` binding;
there is no email-provider API key. The sending domain is `zenguy.com` in the
reviewed Cloudflare account.

1. Use the dashboard for ordinary status checks. For an approved CLI inspection
   or one-time onboarding change, create a short-lived API token limited to the
   exact account/domain and Email Sending operation (the mutating command needs
   `Email Sending: Edit`). Load it from the approved secret manager into
   `CLOUDFLARE_API_TOKEN` for this process only, then verify the target:

       pnpm --filter @zenguy/api exec wrangler whoami

   `whoami` must report API-token authentication and the expected account before
   any Cloudflare mutation. Do not use a personal OAuth profile.

2. Confirm the domain is enabled:

       pnpm --filter @zenguy/api exec wrangler email sending settings zenguy.com

3. If it is not enabled, onboard it once:

       pnpm --filter @zenguy/api exec wrangler email sending enable zenguy.com

4. Revoke the temporary token immediately after the inspection/change. Never
   store it in a profile, dotenv file, shell startup file, command line or this
   repository.
5. Keep `EMAIL_FROM="Zenguy <notifications@zenguy.com>"`. The
   `send_email` binding restricts the Worker to this sender.
6. The development binding has `remote: true`, so `wrangler dev` sends real
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
Cloudflare Queue HTTP pull consumer, independent primary/fallback bootstrap
tokens plus a capability-signing secret, the pinned
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
| Staging | `zenguy-api-staging` | `https://staging-app.zenguy.com` | `staging-app.zenguy.com/api/*` and `api-staging.zenguy.com` | Stripe test | Access app/AUD pending |
| Production | `zenguy-api-production` | `https://app.zenguy.com` | `app.zenguy.com/api/*` and `api.zenguy.com` | Stripe live | Operational |

Production owns both `app.zenguy.com/api/*` and `api.zenguy.com`. Its Stripe
catalog, signed webhook, and Worker secrets are live-only. Never substitute
test values in production.

Do not configure either complete application hostname as a Worker custom
domain. Pages owns the hostname and static routes; the Worker Route owns only
the `/api/*` path.

### 1. Confirm the Cloudflare account

Staging and production deployments and migrations run through their protected
GitHub Environments with separate, resource-scoped API tokens. A manual fallback
is allowed only in an approved change window while its automation is unavailable;
it uses a separate short-lived token with the exact permissions needed. Personal
OAuth profiles are forbidden. During an approved one-off inspection or fallback,
load the matching token from the secret manager into
`CLOUDFLARE_API_TOKEN`, run
`pnpm --filter @zenguy/api exec wrangler whoami`, confirm account
`ec11e46fe3c39a5eac9951db9c91244a`, then revoke the token when the inspection
ends. Never persist it in Wrangler state, dotenv files or shell configuration.

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

Run these interactive writes only in an approved change window with a temporary
token limited to the selected Worker/environment; revoke it immediately after
the binding-name preflight succeeds.

    pnpm --filter @zenguy/api exec wrangler secret put <NAME> --env staging
    pnpm --filter @zenguy/api exec wrangler secret put <NAME> --env production

`security/required-worker-secrets.json` declares the release inventory for each
named environment. CI lists Wrangler's remote secret metadata and runs the
matching preflight before it is allowed to migrate D1; values are never
returned or logged. Staging's inventory additionally requires
`CF_ACCESS_AUD`.

#### Mandatory Cloudflare Access boundary for staging

Before deploying staging, create one self-hosted Cloudflare Access application
whose public hostnames cover both `staging-app.zenguy.com/*` (including Pages
assets and the `/api/*` Worker Route) and `api-staging.zenguy.com/*`. Its allow
policy must be limited to the intended test identities and require MFA. Do not
add a broad Bypass policy: the API Worker independently rejects staging HTTP
requests unless Cloudflare has injected a cryptographically valid
`Cf-Access-Jwt-Assertion` application token. The sole provider exception is
the exact Stripe callback described below.

The exact team origin, `https://bugfer.cloudflareaccess.com`, is pinned as the
non-secret staging variable `CF_ACCESS_TEAM_DOMAIN` in `wrangler.jsonc`. No
application exists yet, so the repository deliberately does not invent or
commit an audience. After creating the application, copy its exact AUD tag into
the staging-only Worker binding; this command prompts without putting the value
in the command line:

    pnpm --filter @zenguy/api exec wrangler secret put CF_ACCESS_AUD --env staging

`CF_ACCESS_AUD` must be the audience of the application covering both staging
hostnames. Until it exists, staging deliberately fails closed. Missing or
malformed bindings,
an absent header on protected routes, a cookie without the assertion header, a
non-RS256 signature,
or a token with the wrong issuer, audience, JOSE/payload type, subject, issuance
time, expiration, or not-before time all produce the same non-cacheable HTTP
403 response. Development and production do not consult these staging-only
bindings.

The Worker guard protects API requests only; it cannot protect Pages assets
which never enter the Worker. The remote Access application is therefore still
required for the full staging SPA. Likewise, every ordinary non-browser caller
(runner, smoke monitor, and CLI) must first authenticate to Access so
Cloudflare can inject the application assertion.

Stripe cannot supply Access credentials. Create a separate, most-specific
Access application for exactly
`staging-app.zenguy.com/api/webhooks/stripe` with a Bypass policy, leaving every
broader staging path under the MFA application. The code-side exception is
narrower than the edge policy: it accepts only `POST` on that exact HTTPS
origin/path, with no query string and a non-empty `Stripe-Signature` header,
then applies the 256 KiB stream cap and timestamped Stripe HMAC verification.
Every other host, path, method, missing signature, oversized body, or invalid
HMAC remains denied. Do not configure a wildcard webhook bypass.

The canonical remote release inventory is
`security/required-worker-secrets.json`. Its `core` group covers boot-critical
JWT and Google OAuth auth, encryption, runner and Twilio bindings;
`releaseFeatures` additionally
requires all five `TWILIO_*` values, the complete Stripe catalog/API/webhook
set (including both alert-credit IDs), and `EXPO_PUSH_ACCESS_TOKEN`. Staging
also requires `CF_ACCESS_AUD`; production additionally requires
`CF_RUNNER_ACCESS_AUD` for the service-only runner application. The staging and production deployment
preflights check every name before migration without reading or printing any
value. Do not paste secret values into shell history, documentation,
`wrangler.jsonc`, or Git.

`ENCRYPTION_KEY_ID` is a non-secret identifier stored in `wrangler.jsonc`.
`ENCRYPTION_PREVIOUS_KEYS` is an optional secret containing a JSON object from
old key IDs to their base64-encoded 32-byte keys. It must be absent outside an
active rotation window.

#### Rotate encrypted application data

Every new workspace secret, notification-channel config, and uptime header/body
is written as an AES-256-GCM v4 envelope. The first write for a workspace
creates a cryptographically random 32-byte data-encryption key (DEK) and stores
only its authenticated wrapping in `workspace_data_encryption_keys`. The DEK is
wrapped with AES-256-GCM under the versioned environment key-encryption key
(KEK); ciphertext AAD binds the format, DEK ID, record type, workspace ID, and
record ID. Key-wrap AAD separately binds the wrap version, KEK ID, workspace,
and DEK ID. v1-v3 remain read-only migration formats.

Apply migrations `0039_workspace_data_encryption_keys.sql` and
`0040_encrypted_write_fence.sql`, in that order, before deploying a Worker that
writes v4. Migration 0040 installs D1 `BEFORE INSERT/UPDATE` fences for secrets,
notification channels, and both uptime sensitive fields. The fence checks the
embedded DEK ID against the workspace's active generation inside the same SQL
statement and rejects every new or changed non-null v1-v3 value. Existing
legacy rows remain readable for the bounded migration only. For secrets, the
same statement requires `encryption_version = 4`; encrypted record IDs and
workspace IDs are immutable because both participate in AAD. Encrypted writes
therefore fail closed during the short interval between applying 0040 and
deploying the v4 Worker. A request paused across a rotation is re-encrypted and
retried at most three times; repeated rotation returns HTTP 409 before audit
records, queueing, or other post-write effects run.

In staging and production, v4 DEKs are not wrapped with `ENCRYPTION_KEY`.
`KEY_WRAPPING` is a private Service Binding to `zenguy-kms-<environment>` and
the KMS entrypoint accepts only structured DEK wrap/unwrap RPC calls. It has no
public `fetch`, route, `workers.dev` subdomain, preview URL, cron, or queue. Each
KEK is provisioned through Cloudflare's official `secret_key` API as an
AES-256-GCM `CryptoKey` with only `encrypt`/`decrypt` usages. Workerd's
`CryptoKey` binding defaults `extractable` to false, and the KMS rejects a key
that is exportable, has another algorithm/size/usage, or is not in the
versioned key-ID/binding allowlist. See the official
[secret_key API schema](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/secrets/methods/update/),
[workerd CryptoKey configuration](https://github.com/cloudflare/workerd/blob/main/src/workerd/server/workerd.capnp),
and [Service Binding RPC documentation](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/).

`ENCRYPTION_KEY` and `ENCRYPTION_PREVIOUS_KEYS` remain temporarily required for
read-only v1-v3 migration. Cloudflare Worker Secrets and Secrets Store expose
their text to Worker code, so neither is accepted as the effective remote v4
KEK. Local development deliberately retains the in-process provider.

#### Bootstrap the private key-wrapping Worker

This is a remote change and is not performed by repository tests or preflight:

1. In the protected target Environment, deploy the unreachable KMS shell with
   `pnpm --filter @zenguy/api deploy:kms:bootstrap:staging` or the exact
   `:production` variant. Do not bind the API to it yet.
2. Generate an independent 32-byte KEK in the approved secret manager. Using a
   narrowly scoped `Workers Scripts Write` token, call Cloudflare's documented
   `PUT /accounts/{account_id}/workers/scripts/zenguy-kms-<environment>/secrets`
   endpoint once. Stream the request from the secret manager; do not put the
   key in argv, an environment variable, a file, logs, or Git. The request must
   have `name` equal to the reviewed `KMS_KEY_*` binding and metadata equivalent
   to `type: secret_key`, `format: raw`, `algorithm: {name: AES-GCM}`, and
   `usages: [encrypt, decrypt]`; `key_base64` is the transient input only.
3. Run `pnpm --filter @zenguy/api deploy:preflight:<environment>`. It calls
   `wrangler secret list --format json` for both Workers and validates names,
   type, format, algorithm and usages. It rejects any value-bearing response and
   never fetches or prints key bytes.
4. Deploy the KMS first, then the API. Normal CI enforces this order. The API
   fails at configuration load in a named environment if `KEY_WRAPPING` or
   `KEY_WRAPPING_KEY_ID` is absent/malformed; it never falls back to
   `ENCRYPTION_KEY` for v4.

The initial `secret_key` creation and the first two remote Worker deployments
are the remaining operator-controlled SEC-23 actions. Repository code cannot
perform them without the KEK and Cloudflare deployment authority.

#### Rotate a non-exportable v4 KEK

Use a three-version-safe transition; never switch the KMS and API IDs in one
unsequenced edit:

1. Provision a new `KMS_KEY_*` secret_key binding, leaving the old one intact.
   Add both IDs/bindings to `KEY_WRAPPING_KEY_SET`, set `activeKeyId` to the new
   ID, and temporarily set `writeKeyIds` to `[old, new]` (at most two). Deploy
   the KMS. The still-old API continues writing with old while new is ready.
2. Change `KEY_WRAPPING_KEY_ID` in the target API environment (and matching
   bootstrap config) to new. Preflight and deploy the API. Responses whose key
   ID differs from the requested ID are rejected.
3. Reduce KMS `writeKeyIds` to `[new]` but retain both entries in `keys`; deploy
   the KMS. Old envelopes remain read-only. For each workspace, call
   `POST /api/workspaces/:workspaceId/security/encryption/rotate?limit=50`
   until `hasMore` is false. Re-wrapping is compare-and-swap and preserves data
   ciphertext; v1-v3/retired-DEK records are rewritten to v4.
4. Use a metadata-only D1 count grouped by `wrapping_key_id` to prove no live DEK
   references old. Retain old while any approved backup can restore it. Only
   after the retention window may a separate approved change remove old from
   `keys`, deploy the KMS, and delete its remote binding. Unknown IDs fail
   closed.

Rollback before old is retired: keep `[old, new]` writable, restore the API's
`KEY_WRAPPING_KEY_ID` to old and deploy the API first; then restore old as KMS
`activeKeyId`/sole writer. Preserve both read bindings until all new envelopes
are re-wrapped or the rollback is abandoned. Never roll back by restoring v4
wrapping to `ENCRYPTION_KEY`.

To rotate a workspace DEK, first call the endpoint normally and retain its
`activeDataKeyId`. Then call it once with
`?rotateDataKeyFrom=<activeDataKeyId>&limit=50`; the optimistic precondition
prevents a retried request from creating a second generation. Continue calling
the endpoint without `rotateDataKeyFrom` until `hasMore` is false. Retired DEKs
remain available for dual-read during the migration and backup-retention
window; never delete them before every referencing ciphertext and retained
backup has expired.

Never deploy an API version whose `KEY_WRAPPING_KEY_ID` is outside the KMS
`writeKeyIds` allowlist. A gradual API deployment is safe only during the
explicit two-write-ID transition above; do not reduce the KMS to new-only until
all old API traffic is gone. Legacy text-secret rotation remains a separate
versioned change; see the
[Workers secrets documentation](https://developers.cloudflare.com/workers/configuration/secrets/).

For local development, keep the current key and its ID available while placing
the replacement key/ID in the dedicated Keychain service with the interactive
`secrets:set -- NAME --replace` flow. First add the former key to the
`ENCRYPTION_PREVIOUS_KEYS` Keychain item, complete the same per-workspace
rotation endpoint, and prove that every retained local D1 database and approved
backup has no dependency on it. Removing that item or the retired entry is a
destructive follow-up and is never performed by the development wrapper.

The KMS rollout changes only the DEK wrapping provider. Migrations 0039/0040 and
the existing `w1:<keyId>:<iv>:<ciphertext>` envelope remain compatible; no new
D1 migration is required.

Environment variables are fixed as follows:

| Variable | Staging | Production |
|---|---|---|
| `ENVIRONMENT` | `staging` | `production` |
| `APP_URL` | `https://staging-app.zenguy.com` | `https://app.zenguy.com` |
| `CF_ACCESS_TEAM_DOMAIN` | `https://bugfer.cloudflareaccess.com` | `https://bugfer.cloudflareaccess.com` |
| `CF_ACCESS_AUD` | exact staging Access application AUD (required binding) | not used |
| `CF_RUNNER_ACCESS_AUD` | not used | exact service-only runner Access AUD (required binding) |
| `ENCRYPTION_KEY_ID` | unique staging key ID | unique production key ID |
| `KEY_WRAPPING_KEY_ID` | active staging KMS key ID | active production KMS key ID |
| `KEY_WRAPPING` | `zenguy-kms-staging` named RPC entrypoint | `zenguy-kms-production` named RPC entrypoint |
| `STRIPE_ENVIRONMENT` | `test` | `live` |
| `LLM_MODEL` | `qwen/qwen3.8-27b` | `qwen/qwen3.8-27b` |
| `EMAIL_FROM` | `Zenguy <notifications@zenguy.com>` | `Zenguy <notifications@zenguy.com>` |

The three required Google OAuth bindings are environment-specific secrets, not
Wrangler vars. Production, staging, and local development must use their
matching client credentials and independent state-signing secret.

Staging uses only Stripe test keys, price IDs, customers, and its verified
staging webhook secret. Production must use only Stripe live
equivalents and its own production webhook secret once activated. Browser
inference is performed by the separately configured local runner. Deployed
environments use the native Cloudflare Email Service `EMAIL` binding for the
enabled `zenguy.com` sending domain.

### 4. Migrate and deploy the selected environment

The protected workflows execute these exact environment-specific targets. If an
automation is unavailable, apply them only in its approved fallback change window
with a temporary token scoped to that environment:

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
migrates `zenguy-staging-db` and deploys `zenguy-api-staging`. It never wipes
or seeds remote application data. The local seed script rejects `--remote` and cannot
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

Create separate Stripe webhook destinations only after their ingress
meets the environment's authentication boundary:

    Test (blocked pending the exact path-specific Access Bypass app):
      https://staging-app.zenguy.com/api/webhooks/stripe
    Live (release gate): https://app.zenguy.com/api/webhooks/stripe

Subscribe each destination to the exact event list in **Stripe Billing** above.
Store each endpoint's signing secret only in its matching Worker environment.
The handler verifies the raw body against `Stripe-Signature`, accepts key
rotation signatures, enforces a five-minute timestamp tolerance, and records
provider event IDs in KV. D1 uniqueness remains the final idempotency boundary
for concurrent deliveries.

The cleanup cron expires operational data after 30 days. Add a 35-day R2
lifecycle safety net to each bucket in an approved change window with a temporary
token limited to R2 configuration for the selected bucket:

    pnpm --filter @zenguy/api exec wrangler r2 bucket lifecycle add zenguy-staging-artifacts retention-safety-net --expire-days 35
    pnpm --filter @zenguy/api exec wrangler r2 bucket lifecycle add zenguy-artifacts retention-safety-net --expire-days 35

## Post-deploy smoke

Run the full functional smoke in staging first and stop the release on the
first failure:

1. Call `https://staging-app.zenguy.com/api/health` without Access and expect
   the generic HTTP 403 envelope. Authenticate through the staging Access app,
   call it again, and expect HTTP 200 with `data.ok=true`. Load the hostname
   without `/api` and confirm the Access-protected Pages application is served.
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
`zenguy.com`, and billing config reports `mode: "stripe"`. Any live checkout
requires the approved live catalog, restricted key and webhook smoke test.

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
Service recipient, the Stripe test webhook destination and
checkout, and an external failure/recovery delivery have not yet been approved
or exercised. Production remains isolated until its Stripe live and Twilio
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
| 31.7.8 | Webhooks are idempotent | Automated: application/billing/handle_stripe_webhook.test.ts and http/routes/webhooks.test.ts |
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
