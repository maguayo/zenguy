# Zenguy frontend

The product UI is a React application built with Vite. It shares an origin with
the API in production and therefore always calls relative `/api/*` URLs.

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

## Production

The API Worker serves `apps/frontend/dist` as static assets and handles `/api/*`
itself. Always build the frontend before deploying the API Worker:

```sh
pnpm --filter @zenguy/frontend build
pnpm --filter @zenguy/api exec wrangler deploy --env production
```

There are no frontend runtime environment variables. Runtime settings such as
the Paddle client token, environment, and price ID come from
`GET /api/billing/config`.
