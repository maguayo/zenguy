# @zenguy/admin

Internal, read-only platform panel served from `admin.zenguy.com` by a single
Cloudflare Worker (`zenguy-admin`):

- `/api/*` — Hono API (session cookie, D1 reads).
- everything else — the React SPA through Workers Assets (`dist/client`).

## Guarantees

- The Worker binds the **production** D1 database. Product data access is
  read-only; the only writes are hashed, revocable rows in `admin_sessions`.
  It never selects `password_hash`, product `token_hash` or `encrypted_*`
  columns.
- Login is delegated server to server to `POST {ZENGUY_API_ORIGIN}/api/auth/login`;
  the returned tokens are discarded. The returned account must be verified and
  its stable user id must be in `ADMIN_USER_IDS`; email is never the authority.
- The Cloudflare Access gate and the credential login are deliberately
  **independent factors**: the Access identity (e.g. a personal-inbox OTP) does
  not need to match the Zenguy account email that signs in here. Do not add an
  equality check between the two — it locks out the intended two-identity setup.
- The admin session is a random, opaque `__Host-zenguy_admin_session` cookie
  (30 minutes, HttpOnly/Secure/SameSite=Strict). D1 stores only its SHA-256
  digest and rechecks expiry, revocation, verification and `auth_version` on
  every request. Logout and password reset therefore revoke it immediately.
- `workers.dev` and preview URLs are disabled. Before deployment,
  `admin.zenguy.com` must additionally be covered by a Cloudflare Access policy
  that requires MFA. Treat absence of that policy as a deployment blocker.

## Configuration

| Name | Kind | Value |
| --- | --- | --- |
| `ADMIN_USER_IDS` | secret | comma-separated immutable IDs in canonical lowercase `usr_<ULID>` form |
| `ZENGUY_API_ORIGIN` | var | `https://api.zenguy.com` |
| `CF_ACCESS_TEAM_DOMAIN` | var | exact `https://<team>.cloudflareaccess.com` origin; not a secret |
| `CF_ACCESS_AUD` | var | audience tag of the Access application protecting this Worker; not a secret |
| `CLOUDFLARE_ACCOUNT_ID` | var | account scope for the GraphQL Analytics API; not a secret |
| `CF_ANALYTICS_API_TOKEN` | secret, **optional** | read-only API token with `Account · Account Analytics · Read`; enables the costs collector |

## Costs collector

The panel's only scheduled job (`triggers.crons`, 02:15 UTC) reads the account's
usage from the Cloudflare GraphQL Analytics API — Workers requests/CPU, D1 rows
and storage, Durable Objects, Containers, KV, R2, Queues — and upserts one row
per day and metric into `platform_usage_daily`, logging each run in
`platform_usage_collections` (migration `0052`). Both tables are **admin-owned**,
like `admin_sessions`: the product API never touches them and they are the only
rows the panel writes besides sessions. The first run backfills 30 days; nightly
runs re-read the last 3 so late analytics settle. "Actualizar ahora" in the
Costes section triggers the same collection on demand and shows every probe's
outcome, which is how a renamed GraphQL field gets noticed.

Costs are **estimates**: usage × the Workers Paid list prices and included
quotas in `src/server/costs/pricing.ts`, plus the plan's base fee. Cloudflare's
own docs say these datasets are not the billing source of truth; the invoice
lives in the dashboard. The token is deliberately optional so a deploy never
blocks on it — until it is installed the section explains the two setup steps.

`ADMIN_USER_IDS` is intentionally absent from versioned `vars`. Install it as
an encrypted Worker binding with `wrangler secret put ADMIN_USER_IDS`; enter the
value interactively or through the approved secret manager, never in a command
argument, file, log or workflow variable. The protected production deploy runs
`wrangler secret list --format json` before upload and consumes names/types
only; the preflight rejects duplicate entries, non-`secret_text` bindings and
any value-bearing field. The runtime then rejects an absent/empty binding, duplicates, fixture IDs
such as `usr_seed_*`, uppercase IDs and every value that is not a canonical
26-character ULID with the `usr_` prefix.

Keep both Access bindings as reviewed, non-secret `vars` in `wrangler.jsonc`;
do not upload them with `wrangler secret put`. The Worker validates
`Cf-Access-Jwt-Assertion` with the rotating Access JWKS and
fails closed if either binding, signature, issuer, audience or token lifetime is
invalid. Configure the Access policy itself to require independent MFA.

## Commands

```bash
pnpm --filter @zenguy/admin dev              # Vite dev server on :5175 (proxies /api)
pnpm --filter @zenguy/admin dev:worker       # wrangler dev on :8795
pnpm --filter @zenguy/admin typecheck
pnpm --filter @zenguy/admin test             # unit tests
pnpm --filter @zenguy/admin test:integration # D1 tests against apps/api/migrations
pnpm --filter @zenguy/admin test:preflight   # metadata-only preflight tests
pnpm --filter @zenguy/admin deploy:preflight # remote names-only check; production credentials required
pnpm --filter @zenguy/admin deploy           # build + mandatory preflight + deploy
```

`dev:worker` serves the SPA from `dist/client`, so build once before starting it:
`pnpm --filter @zenguy/admin build`.

Integration tests apply the **real** migrations from `apps/api/migrations`, so the
schema under test is always the production one.

## Local smoke test

Never type a real production password into a local build. Point the Worker at a
stub that accepts any login instead, and share apps/api's local D1 (schema and
seed) so the panel has data:

```bash
# 1. a stub API that returns a valid-format, local-only user present in the seed
node -e "require('node:http').createServer((_q,s)=>{s.writeHead(200,{'content-type':'application/json'});s.end('{\"data\":{\"user\":{\"id\":\"usr_00000000000000000000000002\",\"email\":\"ana@zenguy.dev\",\"emailVerified\":true}}}')}).listen(8799)"

# 2. the admin Worker against apps/api's local database
pnpm --filter @zenguy/admin build
cd apps/admin && wrangler dev --port 8795 --persist-to ../api/.wrangler/state \
  --var ZENGUY_API_ORIGIN:http://127.0.0.1:8799 \
  --var ADMIN_USER_IDS:usr_00000000000000000000000002
```

`--persist-to` reuses the local D1 of `apps/api` (same `database_id`), so the
panel shows the seeded data. Those ID/email literals are deterministic local
fixtures, not production identities. `--var` is permitted only for this local
smoke; production requires the encrypted binding and refuses `usr_seed_*`.
Never deploy the stub or enter production credentials into it.
