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

| Environment | Pages project | Production branch | Root directory | Build command | Output directory | Custom domain |
| --- | --- | --- | --- | --- | --- | --- |
| Staging | `zenguy-frontend-staging` | `staging` | `apps/frontend` | `pnpm build` | `dist` | `staging-app.zenguy.com` |
| Production | `zenguy-frontend` | `main` | `apps/frontend` | `pnpm build` | `dist` | `app.zenguy.com` |

Use `apps/frontend` without a leading slash in the Pages root-directory field.
Pushing to `staging` deploys staging; pushing to `main` deploys production.
Preview-branch builds can remain disabled unless a temporary preview is
explicitly needed.

Pages owns both complete application hostnames. Do not attach
`staging-app.zenguy.com` or `app.zenguy.com` as a full custom domain on either
API Worker. Instead, the zone has these Worker Routes:

```text
staging-app.zenguy.com/api/*  -> zenguy-api-staging
app.zenguy.com/api/*          -> zenguy-api-production
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

After a release, verify both the application and its routed API endpoint:

```sh
curl --fail --show-error https://staging-app.zenguy.com/api/health
curl --fail --show-error https://app.zenguy.com/api/health
```

Staging must report Paddle Sandbox configuration. Production must report the
separate live Paddle configuration. Both default to OpenAI `gpt-5-mini` and use
Cloudflare Email Service with senders on `zenguy.com`.
