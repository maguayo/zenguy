# @zenguy/admin

Internal, read-only platform panel served from `admin.zenguy.com` by a single
Cloudflare Worker (`zenguy-admin`):

- `/api/*` — Hono API (session cookie, D1 reads).
- everything else — the React SPA through Workers Assets (`dist/client`).

## Guarantees

- The Worker binds the **production** D1 database and only ever runs `SELECT`
  statements. It never selects `password_hash`, `token_hash` or `encrypted_*`
  columns.
- Login is delegated server to server to `POST {ZENGUY_API_ORIGIN}/api/auth/login`;
  the returned tokens are discarded. The email must also be in `ADMIN_EMAILS`.
- The admin session is a host-only `zenguy_admin_session` cookie
  (`base64url(payload).base64url(HMAC-SHA256)`, 7 days, HttpOnly/Secure/SameSite=Lax).
  No product cookie changes scope.

## Configuration

| Name | Kind | Value |
| --- | --- | --- |
| `ADMIN_EMAILS` | var | comma separated allowlist, e.g. `marcos@aguayo.es` |
| `ZENGUY_API_ORIGIN` | var | `https://api.zenguy.com` |
| `ADMIN_SESSION_SECRET` | secret | >= 32 chars, `wrangler secret put ADMIN_SESSION_SECRET` |

## Commands

```bash
pnpm --filter @zenguy/admin dev              # Vite dev server on :5175 (proxies /api)
pnpm --filter @zenguy/admin dev:worker       # wrangler dev on :8795
pnpm --filter @zenguy/admin typecheck
pnpm --filter @zenguy/admin test             # unit tests
pnpm --filter @zenguy/admin test:integration # D1 tests against apps/api/migrations
pnpm --filter @zenguy/admin deploy           # vite build + wrangler deploy
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
# 1. a stub API that answers 200 to POST /api/auth/login
node -e "require('node:http').createServer((_q,s)=>{s.writeHead(200,{'content-type':'application/json'});s.end('{\"data\":{}}')}).listen(8799)"

# 2. the admin Worker against apps/api's local database
pnpm --filter @zenguy/admin build
cd apps/admin && wrangler dev --port 8795 --persist-to ../api/.wrangler/state \
  --var ZENGUY_API_ORIGIN:http://127.0.0.1:8799 \
  --var ADMIN_SESSION_SECRET:local-admin-secret-local-admin-secret
```

`--persist-to` reuses the local D1 of `apps/api` (same `database_id`), so the
panel shows the seeded data. The session secret must be >= 32 characters or the
Worker refuses to boot, and any allowlisted `ADMIN_EMAILS` address then logs in
with any password.
