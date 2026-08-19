# Zenguy frontend

The product UI is a React application built with Vite. It shares an origin with
the API in deployed environments and therefore always calls relative `/api/*`
URLs. Cloudflare Pages serves the application; a Cloudflare Worker Route
intercepts only `/api/*` on the same hostname.

## Local development

Start the API Worker on port 8787:

```sh
pnpm --filter @zenguy/api dev
```

Then start Vite on port 5173:

```sh
pnpm --filter @zenguy/frontend dev
```

Vite proxies `/api` requests to `http://localhost:8787`. See the API README for
the local migrations and seed steps required before exercising authenticated
flows. If that port is unavailable, set the development-only
`ZENGUY_API_ORIGIN` value in an ignored `apps/frontend/.env.local` file to the
Worker origin you are using.

## Cloudflare Pages deployments

The Git-connected Pages projects use these settings:

| Environment | Pages project | Production branch | Root directory | Build command | Output directory | Custom domain | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Staging | `zenguy-frontend-staging` | `staging` | `apps/frontend` | `pnpm build` | `dist` | `staging-app.zenguy.com` | Operational with API |
| Production | `zenguy-frontend` | `main` | `apps/frontend` | `pnpm build` | `dist` | `app.zenguy.com` | Pages ready; API pending activation |

Use `apps/frontend` without a leading slash in the Pages root-directory field.
Pushing to `staging` deploys the staging Pages frontend; pushing to `main`
deploys the production Pages frontend. That Git integration does not deploy the
API Worker. Staging backend CI is prepared but is not connected yet because its
deployment token is missing, so the staging API still uses the manual migration
and deploy commands in `apps/api/README.md`. Preview-branch builds can remain
disabled unless a temporary preview is explicitly needed.

Pages owns both complete application hostnames. Do not attach
`staging-app.zenguy.com` or `app.zenguy.com` as a full custom domain on either
API Worker. Staging currently has the first Worker Route; the second is the
production target and must not be activated until the production release gates
are complete:

```text
Current: staging-app.zenguy.com/api/*  -> zenguy-api-staging
Target:  app.zenguy.com/api/*          -> zenguy-api-production
```

This split lets Pages return HTML, JavaScript, CSS, and other static assets
while the matching Worker handles only API traffic. It also preserves the
same-origin authentication and Paddle flows expected by the frontend.

To verify the frontend build locally before pushing:

```sh
pnpm --filter @zenguy/frontend build
```

There are no frontend runtime environment variables. Runtime settings such as
the Paddle client token, environment, and price ID come from
`GET /api/billing/config`.

Verify staging now. Run the production check only after Paddle Live, Twilio,
the signed production webhook, production secrets, and Worker activation are
complete:

```sh
curl --fail --show-error https://staging-app.zenguy.com/api/health
curl --fail --show-error https://app.zenguy.com/api/health
```

Staging reports Paddle Sandbox configuration. Once activated, production must
report its separate Paddle Live configuration. Both default to OpenAI
`gpt-5-mini` and deployed Workers use Cloudflare Email Service with senders on
`zenguy.com`.
